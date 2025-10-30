import settingsStore from '@/features/stores/settings'
import {
  getBestComment,
  getMessagesForSleep,
  getAnotherTopic,
  getMessagesForNewTopic,
  checkIfResponseContinuationIsRequired,
  getMessagesForContinuation,
} from '@/features/youtube/conversationContinuityFunctions'
import { processAIResponse } from '../chat/handlers'
import homeStore from '@/features/stores/home'
import { messageSelectors } from '../messages/messageSelectors'

export const DEFAULT_YOUTUBE_WEBSOCKET_URL = 'ws://localhost:11180/sub'

export const getLiveChatId = async (
  liveId: string,
  youtubeKey: string
): Promise<string> => {
  const params = {
    part: 'liveStreamingDetails',
    id: liveId,
    key: youtubeKey,
  }
  const query = new URLSearchParams(params)
  const response = await fetch(
    `https://youtube.googleapis.com/youtube/v3/videos?${query}`,
    {
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
  const json = await response.json()
  if (json.items == undefined || json.items.length == 0) {
    return ''
  }
  const liveChatId = json.items[0].liveStreamingDetails.activeLiveChatId
  return liveChatId
}

export type YouTubeComment = {
  userName: string
  userIconUrl: string
  userComment: string
}

type YouTubeComments = YouTubeComment[]

const retrieveLiveComments = async (
  activeLiveChatId: string,
  youtubeKey: string,
  youtubeNextPageToken: string,
  setYoutubeNextPageToken: (token: string) => void
): Promise<YouTubeComments> => {
  console.log('retrieveLiveComments')
  let url =
    'https://youtube.googleapis.com/youtube/v3/liveChat/messages?liveChatId=' +
    activeLiveChatId +
    '&part=authorDetails%2Csnippet&key=' +
    youtubeKey
  if (youtubeNextPageToken !== '' && youtubeNextPageToken !== undefined) {
    url = url + '&pageToken=' + youtubeNextPageToken
  }
  const response = await fetch(url, {
    method: 'get',
    headers: {
      'Content-Type': 'application/json',
    },
  })
  const json = await response.json()
  const items = json.items
  setYoutubeNextPageToken(json.nextPageToken)

  const comments = items
    .map((item: any) => ({
      userName: item.authorDetails.displayName,
      userIconUrl: item.authorDetails.profileImageUrl,
      userComment:
        item.snippet.textMessageDetails?.messageText ||
        item.snippet.superChatDetails?.userComment ||
        '',
    }))
    .filter(
      (comment: any) =>
        comment.userComment !== '' && !comment.userComment.startsWith('#')
    )

  if (comments.length === 0) {
    return []
  }

  return comments
}

type HandleSendChat = (text: string) => Promise<void> | void

export const handleYoutubeContinuationIfNeeded = async (): Promise<boolean> => {
  const ss = settingsStore.getState()
  if (
    ss.youtubeSleepMode ||
    ss.youtubeContinuationCount >= 1 ||
    !ss.conversationContinuityMode
  ) {
    if (ss.youtubeContinuationCount !== 0) {
      settingsStore.setState({ youtubeContinuationCount: 0 })
    }
    return false
  }

  const hs = homeStore.getState()
  const chatLog = messageSelectors.getTextAndImageMessages(hs.chatLog)
  const isContinuationNeeded = await checkIfResponseContinuationIsRequired(
    chatLog
  )
  if (!isContinuationNeeded) {
    if (ss.youtubeContinuationCount !== 0) {
      settingsStore.setState({ youtubeContinuationCount: 0 })
    }
    return false
  }

  const continuationMessage = await getMessagesForContinuation(
    ss.systemPrompt,
    chatLog
  )
  processAIResponse(continuationMessage)
  settingsStore.setState({
    youtubeContinuationCount: ss.youtubeContinuationCount + 1,
  })
  if (ss.youtubeNoCommentCount < 1) {
    settingsStore.setState({ youtubeNoCommentCount: 1 })
  }
  return true
}

export const processIncomingYoutubeComments = async (
  comments: YouTubeComments,
  handleSendChat: HandleSendChat
): Promise<boolean> => {
  if (!comments || comments.length === 0) {
    return false
  }

  const ss = settingsStore.getState()
  const hs = homeStore.getState()
  const chatLog = messageSelectors.getTextAndImageMessages(hs.chatLog)

  settingsStore.setState({
    youtubeNoCommentCount: 0,
    youtubeSleepMode: false,
  })

  let selectedComment = ''
  if (ss.conversationContinuityMode) {
    selectedComment = await getBestComment(chatLog, comments)
  } else {
    selectedComment =
      comments[Math.floor(Math.random() * comments.length)].userComment
  }

  if (!selectedComment) {
    return false
  }

  console.log('selectedYoutubeComment:', selectedComment)
  await handleSendChat(selectedComment)
  return true
}

export const handleYoutubeNoComments = async (): Promise<void> => {
  const ss = settingsStore.getState()
  const hs = homeStore.getState()
  const chatLog = messageSelectors.getTextAndImageMessages(hs.chatLog)
  const noCommentCount = ss.youtubeNoCommentCount + 1

  if (ss.conversationContinuityMode) {
    if (noCommentCount < 3 || (3 < noCommentCount && noCommentCount < 6)) {
      const continuationMessage = await getMessagesForContinuation(
        ss.systemPrompt,
        chatLog
      )
      processAIResponse(continuationMessage)
    } else if (noCommentCount === 3) {
      const anotherTopic = await getAnotherTopic(chatLog)
      console.log('anotherTopic:', anotherTopic)
      const newTopicMessage = await getMessagesForNewTopic(
        ss.systemPrompt,
        chatLog,
        anotherTopic
      )
      processAIResponse(newTopicMessage)
    } else if (noCommentCount === 6) {
      const messagesForSleep = await getMessagesForSleep(
        ss.systemPrompt,
        chatLog
      )
      processAIResponse(messagesForSleep)
      settingsStore.setState({ youtubeSleepMode: true })
    }
  }
  console.log('YoutubeNoCommentCount:', noCommentCount)
  settingsStore.setState({ youtubeNoCommentCount: noCommentCount })
}

export const fetchAndProcessComments = async (
  handleSendChat: HandleSendChat
): Promise<void> => {
  try {
    const continuationHandled = await handleYoutubeContinuationIfNeeded()
    if (continuationHandled) {
      return
    }

    const ss = settingsStore.getState()
    const liveChatId = await getLiveChatId(ss.youtubeLiveId, ss.youtubeApiKey)
    if (!liveChatId) {
      return
    }

    const youtubeComments = await retrieveLiveComments(
      liveChatId,
      ss.youtubeApiKey,
      ss.youtubeNextPageToken,
      (token: string) => settingsStore.setState({ youtubeNextPageToken: token })
    )

    if (youtubeComments.length > 0) {
      await processIncomingYoutubeComments(youtubeComments, handleSendChat)
      return
    }

    await handleYoutubeNoComments()
  } catch (error) {
    console.error('Error fetching comments:', error)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const pickFirstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed !== '') {
        return trimmed
      }
    }
  }
  return ''
}

type ProcessedIdsOption = {
  processedIds?: Set<string>
}

export const mapOneCommePayloadToComments = (
  payload: unknown,
  options: ProcessedIdsOption = {}
): YouTubeComments => {
  if (!isRecord(payload)) {
    return []
  }

  if (payload.type !== 'comments') {
    return []
  }

  if (!isRecord(payload.data)) {
    return []
  }

  const comments = payload.data.comments
  if (!Array.isArray(comments)) {
    return []
  }

  const processedIds = options.processedIds
  const mappedComments: YouTubeComments = []

  for (const rawComment of comments) {
    if (!isRecord(rawComment)) {
      continue
    }

    const service = typeof rawComment.service === 'string' ? rawComment.service : ''
    if (service && service !== 'youtube') {
      continue
    }

    const commentId =
      typeof rawComment.id === 'string' ? rawComment.id : undefined
    if (commentId && processedIds?.has(commentId)) {
      continue
    }

    const rawData = isRecord(rawComment.data) ? rawComment.data : {}

    const userComment = pickFirstString(
      rawData.comment,
      rawData.speechText,
      rawData.text,
      rawComment.comment
    )

    if (!userComment || userComment.startsWith('#')) {
      continue
    }

    const userName = pickFirstString(
      rawData.displayName,
      rawData.name,
      rawComment.name
    )

    const userIconUrl =
      typeof rawData.profileImage === 'string' ? rawData.profileImage : ''

    mappedComments.push({
      userName: userName || 'YouTubeUser',
      userIconUrl,
      userComment,
    })

    if (commentId && processedIds) {
      processedIds.add(commentId)
    }
  }

  return mappedComments
}
