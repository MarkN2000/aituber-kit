import { useCallback, useEffect, useRef } from 'react'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import {
  DEFAULT_YOUTUBE_WEBSOCKET_URL,
  fetchAndProcessComments,
  handleYoutubeContinuationIfNeeded,
  handleYoutubeNoComments,
  mapOneCommePayloadToComments,
  processIncomingYoutubeComments,
} from '@/features/youtube/youtubeComments'

const INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS = 10000 // 10秒

interface Params {
  handleSendChat: (text: string) => Promise<void>
}

const useYoutube = ({ handleSendChat }: Params) => {
  const youtubePlaying = settingsStore((s) => s.youtubePlaying)
  const youtubeCommentSource = settingsStore((s) => s.youtubeCommentSource)
  const youtubeWebSocketUrl = settingsStore((s) => s.youtubeWebSocketUrl)
  const commentReceivedSinceLastTickRef = useRef(false)
  const processedCommentIdsRef = useRef<Set<string>>(new Set())

  const fetchAndProcessCommentsCallback = useCallback(async () => {
    const ss = settingsStore.getState()
    const hs = homeStore.getState()

    if (
      ss.youtubeCommentSource !== 'api' ||
      !ss.youtubeLiveId ||
      !ss.youtubeApiKey ||
      hs.chatProcessing ||
      hs.chatProcessingCount > 0 ||
      !ss.youtubeMode ||
      !ss.youtubePlaying
    ) {
      return
    }

    console.log('Call fetchAndProcessComments !!!')
    await fetchAndProcessComments(handleSendChat)
  }, [handleSendChat])

  useEffect(() => {
    if (!youtubePlaying || youtubeCommentSource !== 'api') return
    fetchAndProcessCommentsCallback()

    const intervalId = setInterval(() => {
      fetchAndProcessCommentsCallback()
    }, INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS)

    return () => clearInterval(intervalId)
  }, [youtubePlaying, youtubeCommentSource, fetchAndProcessCommentsCallback])

  useEffect(() => {
    if (!youtubePlaying || youtubeCommentSource !== 'websocket') return

    commentReceivedSinceLastTickRef.current = false

    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let manuallyClosed = false

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const scheduleReconnect = () => {
      if (manuallyClosed) return
      clearReconnectTimer()
      reconnectTimer = setTimeout(() => {
        if (!manuallyClosed) {
          connect()
        }
      }, 3000)
    }

    const resolveWebSocketUrl = () => {
      const latestUrl = settingsStore.getState().youtubeWebSocketUrl
      if (typeof latestUrl === 'string' && latestUrl.trim() !== '') {
        return latestUrl.trim()
      }

      if (typeof youtubeWebSocketUrl === 'string' && youtubeWebSocketUrl.trim() !== '') {
        return youtubeWebSocketUrl.trim()
      }

      return DEFAULT_YOUTUBE_WEBSOCKET_URL
    }

    const handleOpen = () => {
      console.log('YouTube WebSocket connected')
    }

    const handleMessage = async (event: MessageEvent) => {
      try {
        if (typeof event.data !== 'string') {
          return
        }

        const payload = JSON.parse(event.data)
        const ss = settingsStore.getState()
        const hs = homeStore.getState()

        if (
          hs.chatProcessing ||
          hs.chatProcessingCount > 0 ||
          !ss.youtubeMode ||
          !ss.youtubePlaying ||
          ss.youtubeCommentSource !== 'websocket'
        ) {
          return
        }

        const mappedComments = mapOneCommePayloadToComments(payload, {
          processedIds: processedCommentIdsRef.current,
        })
        if (mappedComments.length === 0) return

        commentReceivedSinceLastTickRef.current = true
        await processIncomingYoutubeComments(mappedComments, handleSendChat)
      } catch (error) {
        console.error('Error processing YouTube WebSocket message:', error)
      }
    }

    const handleError = (event: Event) => {
      console.error('YouTube WebSocket error:', event)
    }

    const handleClose = () => {
      console.log('YouTube WebSocket closed')
      socket = null
      scheduleReconnect()
    }

    function connect() {
      const currentUrl = resolveWebSocketUrl()

      try {
        socket = new WebSocket(currentUrl)
      } catch (error) {
        console.error('Failed to create YouTube WebSocket:', error)
        scheduleReconnect()
        return
      }

      socket.addEventListener('open', handleOpen)
      socket.addEventListener('message', handleMessage)
      socket.addEventListener('error', handleError)
      socket.addEventListener('close', handleClose)
    }

    processedCommentIdsRef.current.clear()
    connect()

    return () => {
      manuallyClosed = true
      clearReconnectTimer()
      if (socket) {
        socket.removeEventListener('open', handleOpen)
        socket.removeEventListener('message', handleMessage)
        socket.removeEventListener('error', handleError)
        socket.removeEventListener('close', handleClose)
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close()
        }
      }
      socket = null
      processedCommentIdsRef.current.clear()
    }
  }, [
    youtubePlaying,
    youtubeCommentSource,
    youtubeWebSocketUrl,
    handleSendChat,
  ])

  useEffect(() => {
    if (!youtubePlaying || youtubeCommentSource !== 'websocket') return

    const runTick = async () => {
      const ss = settingsStore.getState()
      const hs = homeStore.getState()

      if (
        hs.chatProcessing ||
        hs.chatProcessingCount > 0 ||
        !ss.youtubeMode ||
        !ss.youtubePlaying
      ) {
        return
      }

      try {
        const continuationHandled = await handleYoutubeContinuationIfNeeded()
        if (continuationHandled) {
          commentReceivedSinceLastTickRef.current = false
          return
        }

        if (commentReceivedSinceLastTickRef.current) {
          commentReceivedSinceLastTickRef.current = false
          settingsStore.setState({ youtubeNoCommentCount: 0 })
          return
        }

        await handleYoutubeNoComments()
      } catch (error) {
        console.error('Error handling YouTube WebSocket idle tick:', error)
      }
    }

    runTick()

    const intervalId = setInterval(() => {
      runTick()
    }, INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS)

    return () => clearInterval(intervalId)
  }, [youtubePlaying, youtubeCommentSource])
}

export default useYoutube
