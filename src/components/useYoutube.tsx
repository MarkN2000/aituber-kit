import { useCallback, useEffect } from 'react'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import { fetchAndProcessComments } from '@/features/youtube/youtubeComments'

const INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS_YOUTUBE = 10000 // 10秒
const INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS_ONECOMME = 2000 // 2秒

interface Params {
  handleSendChat: (text: string) => Promise<void>
}

const useYoutube = ({ handleSendChat }: Params) => {
  const youtubePlaying = settingsStore((s) => s.youtubePlaying)
  const selectCommentSource = settingsStore((s) => s.selectCommentSource)

  const fetchAndProcessCommentsCallback = useCallback(async () => {
    const ss = settingsStore.getState()
    const hs = homeStore.getState()

    if (
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
    if (!youtubePlaying) return
    fetchAndProcessCommentsCallback()

    const intervalTime =
      selectCommentSource === 'onecomme'
        ? INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS_ONECOMME
        : INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS_YOUTUBE

    const intervalId = setInterval(() => {
      fetchAndProcessCommentsCallback()
    }, intervalTime)

    return () => clearInterval(intervalId)
  }, [youtubePlaying, fetchAndProcessCommentsCallback, selectCommentSource])
}

export default useYoutube
