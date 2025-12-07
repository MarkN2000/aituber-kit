import { Message } from '@/features/messages/messages'
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

type YouTubeComment = {
  id?: string
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
      id: item.id,
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

const retrieveOnecommeComments = async (
  onecommeUrl: string,
  lastCommentId: string,
  setLastCommentId: (id: string) => void
): Promise<YouTubeComments> => {
  try {
    const response = await fetch(`${onecommeUrl}/api/comments`, {
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const json = await response.json()
    const commentsData = Array.isArray(json) ? json : []

    const comments = commentsData
      .map((item: any) => ({
        id: item.data?.id || item.id || '',
        userName: item.data?.name || item.name || 'Unknown',
        userIconUrl: item.data?.profileImage || item.profileImage || '',
        userComment: item.data?.comment || item.comment || '',
      }))
      .filter(
        (comment: any) =>
          comment.userComment !== '' && !comment.userComment.startsWith('#')
      )
    
    if (comments.length === 0) return []

    let newComments: YouTubeComment[] = []

    if (lastCommentId) {
      const lastIndex = comments.findIndex((c: any) => c.id === lastCommentId)
      if (lastIndex !== -1) {
        // IDが見つかった場合: それ以降のコメントを新規とする
        newComments = comments.slice(lastIndex + 1)
      } else {
        // IDが見つからない場合 (ログ流れ、再起動後など):
        // 安全のため、最新の1件だけを処理する
        newComments = [comments[comments.length - 1]]
      }
    } else {
      // 初回起動時 (lastCommentIdがない場合):
      // 過去ログを全て読み上げないよう、最新の1件だけを処理する
      newComments = [comments[comments.length - 1]]
    }

    // IDが見つかった場合に、処理する件数を最大2件に制限する
    if (newComments.length > 2) {
      newComments = newComments.slice(-2)
    }

    if (newComments.length > 0) {
      setLastCommentId(newComments[newComments.length - 1].id || '')
    } else if (comments.length > 0 && !lastCommentId) {
      // 初回でフィルタリングにより0件になった場合なども、
      // 次回以降のために最新IDは保存しておく
      setLastCommentId(comments[comments.length - 1].id || '')
    }

    return newComments
  } catch (error) {
    console.error('Error fetching OneComme comments:', error)
    return []
  }
}

export const fetchAndProcessComments = async (
  handleSendChat: (text: string) => void
): Promise<void> => {
  const ss = settingsStore.getState()
  const hs = homeStore.getState()
  const chatLog = messageSelectors.getTextAndImageMessages(hs.chatLog)

  try {
    let youtubeComments: YouTubeComments = []
    
    // 会話継続チェック処理
    // 注: わんコメの場合も会話継続モードは機能させるが、
    // liveChatIdの取得チェックはYouTubeモードのときのみ行う形に分岐する
    
    // 処理実行フラグ
    let shouldFetchComments = false

    if (ss.selectCommentSource === 'onecomme') {
      shouldFetchComments = true
    } else {
      const liveChatId = await getLiveChatId(ss.youtubeLiveId, ss.youtubeApiKey)
      if (liveChatId) {
        shouldFetchComments = true
      }
    }

    if (shouldFetchComments) {
      // 会話の継続が必要かどうかを確認
      if (
        !ss.youtubeSleepMode &&
        ss.youtubeContinuationCount < 1 &&
        ss.conversationContinuityMode
      ) {
        const isContinuationNeeded =
          await checkIfResponseContinuationIsRequired(chatLog)
        if (isContinuationNeeded) {
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
          return
        }
      }
      settingsStore.setState({ youtubeContinuationCount: 0 })

      // コメントを取得
      if (ss.selectCommentSource === 'onecomme') {
        youtubeComments = await retrieveOnecommeComments(
          ss.onecommeUrl,
          ss.onecommeLastCommentId,
          (id) => settingsStore.setState({ onecommeLastCommentId: id })
        )
      } else {
        const liveChatId = await getLiveChatId(ss.youtubeLiveId, ss.youtubeApiKey)
        if (liveChatId) {
           youtubeComments = await retrieveLiveComments(
            liveChatId,
            ss.youtubeApiKey,
            ss.youtubeNextPageToken,
            (token: string) =>
              settingsStore.setState({ youtubeNextPageToken: token })
          )
        }
      }

      // ランダムなコメントを選択して送信
      if (youtubeComments.length > 0) {
        settingsStore.setState({ youtubeNoCommentCount: 0 })
        settingsStore.setState({ youtubeSleepMode: false })
        let selectedComment = ''
        if (ss.conversationContinuityMode) {
          selectedComment = await getBestComment(chatLog, youtubeComments)
        } else {
          selectedComment =
            youtubeComments[Math.floor(Math.random() * youtubeComments.length)]
              .userComment
        }

        handleSendChat(selectedComment)
      } else {
        const noCommentCount = ss.youtubeNoCommentCount + 1
        if (ss.conversationContinuityMode) {
          if (
            noCommentCount < 3 ||
            (3 < noCommentCount && noCommentCount < 6)
          ) {
            // 会話の続きを生成
            const continuationMessage = await getMessagesForContinuation(
              ss.systemPrompt,
              chatLog
            )
            processAIResponse(continuationMessage)
          } else if (noCommentCount === 3) {
            // 新しいトピックを生成
            const anotherTopic = await getAnotherTopic(chatLog)
            console.log('anotherTopic:', anotherTopic)
            const newTopicMessage = await getMessagesForNewTopic(
              ss.systemPrompt,
              chatLog,
              anotherTopic
            )
            processAIResponse(newTopicMessage)
          } else if (noCommentCount === 6) {
            // スリープモードにする
            const messagesForSleep = await getMessagesForSleep(
              ss.systemPrompt,
              chatLog
            )
            processAIResponse(messagesForSleep)
            settingsStore.setState({ youtubeSleepMode: true })
          }
        }
        settingsStore.setState({ youtubeNoCommentCount: noCommentCount })
      }
    }
  } catch (error) {
    console.error('Error fetching comments:', error)
  }
}
