import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import settingsStore from '@/features/stores/settings'
import { TextButton } from '../textButton'

const timeZoneOptions = [
  { label: 'UTC', value: 'UTC' },
  { label: 'Pacific/Honolulu (Hawaii)', value: 'Pacific/Honolulu' },
  { label: 'America/Anchorage (Alaska)', value: 'America/Anchorage' },
  { label: 'America/Los_Angeles (Pacific Time)', value: 'America/Los_Angeles' },
  { label: 'America/Denver (Mountain Time)', value: 'America/Denver' },
  { label: 'America/Chicago (Central Time)', value: 'America/Chicago' },
  { label: 'America/New_York (Eastern Time)', value: 'America/New_York' },
  { label: 'America/Sao_Paulo (Brazil)', value: 'America/Sao_Paulo' },
  { label: 'Europe/London (UK)', value: 'Europe/London' },
  { label: 'Europe/Paris (Central Europe)', value: 'Europe/Paris' },
  { label: 'Europe/Athens (Eastern Europe)', value: 'Europe/Athens' },
  { label: 'Europe/Moscow (Moscow)', value: 'Europe/Moscow' },
  { label: 'Asia/Dubai (Gulf)', value: 'Asia/Dubai' },
  { label: 'Asia/Kolkata (India)', value: 'Asia/Kolkata' },
  { label: 'Asia/Bangkok (Indochina)', value: 'Asia/Bangkok' },
  { label: 'Asia/Shanghai (China)', value: 'Asia/Shanghai' },
  { label: 'Asia/Tokyo (Japan)', value: 'Asia/Tokyo' },
  { label: 'Australia/Sydney (Sydney)', value: 'Australia/Sydney' },
  { label: 'Pacific/Auckland (New Zealand)', value: 'Pacific/Auckland' },
]

const AdvancedSettings = () => {
  const includeTimestampInUserMessage = settingsStore(
    (s) => s.includeTimestampInUserMessage
  )
  const timestampTimeZone = settingsStore((s) => s.timestampTimeZone)
  const useVideoAsBackground = settingsStore((s) => s.useVideoAsBackground)
  const showQuickMenu = settingsStore((s) => s.showQuickMenu)

  const [isCustomMode, setIsCustomMode] = useState(
    !timeZoneOptions.some((option) => option.value === timestampTimeZone) &&
      timestampTimeZone !== ''
  )

  const { t } = useTranslation()

  return (
    <div className="mb-10">
      <div className="mb-6 grid-cols-2">
        <div className="mb-4 text-xl font-bold">{t('LocalStorageReset')}</div>
        <div className="my-4">{t('LocalStorageResetInfo')}</div>
        <TextButton
          onClick={() => {
            settingsStore.persist.clearStorage()
            window.location.reload()
          }}
        >
          {t('LocalStorageResetButton')}
        </TextButton>
      </div>
      <div className="my-6">
        <div className="my-4 text-xl font-bold">
          {t('UseVideoAsBackground')}
        </div>
        <div className="my-2">
          <TextButton
            onClick={() =>
              settingsStore.setState((s) => ({
                useVideoAsBackground: !s.useVideoAsBackground,
              }))
            }
          >
            {useVideoAsBackground ? t('StatusOn') : t('StatusOff')}
          </TextButton>
        </div>
      </div>
      <div className="my-6">
        <div className="my-4 text-xl font-bold">{t('ShowQuickMenu')}</div>
        <div className="my-2">
          <TextButton
            onClick={() =>
              settingsStore.setState((s) => ({
                showQuickMenu: !s.showQuickMenu,
              }))
            }
          >
            {showQuickMenu ? t('StatusOn') : t('StatusOff')}
          </TextButton>
        </div>
      </div>
      <div className="my-6">
        <div className="my-4 text-xl font-bold">
          {t('IncludeTimestampInUserMessage')}
        </div>
        <div className="my-4 whitespace-pre-line">
          {t('IncludeTimestampInUserMessageInfo')}
        </div>
        <div className="my-2">
          <TextButton
            onClick={() =>
              settingsStore.setState({
                includeTimestampInUserMessage: !includeTimestampInUserMessage,
              })
            }
          >
            {includeTimestampInUserMessage ? t('StatusOn') : t('StatusOff')}
          </TextButton>
        </div>
      </div>
      {includeTimestampInUserMessage && (
        <div className="my-6">
          <div className="my-4 text-xl font-bold">{t('TimestampTimeZone')}</div>
          <div className="my-4 whitespace-pre-line">
            {t('TimestampTimeZoneInfo')}
          </div>
          <div className="my-4">
            <div className="mb-2">
              <TextButton
                onClick={() => {
                  // カスタムモード切り替え時に値をリセットするか、あるいはデフォルトに戻すか
                  // ModelSelectorでは特にリセットしていないが、ここではリストにある値ならそのまま、なければデフォルトへ...という挙動が良いか
                  if (!isCustomMode) {
                    // カスタムモードにする場合: 現在の値がリストにあるならクリアする？
                    // いや、そのまま編集できたほうが便利かもしれないが、リスト選択肢の文字列（例: Asia/Tokyo）がinputに入ることになる。
                    // それでOK。
                  } else {
                    // リストモードに戻す場合: 現在の値がリストにないなら、リストの最初の値(UTC)にする
                    if (
                      !timeZoneOptions.some(
                        (option) => option.value === timestampTimeZone
                      )
                    ) {
                      settingsStore.setState({ timestampTimeZone: 'UTC' })
                    }
                  }
                  setIsCustomMode(!isCustomMode)
                }}
              >
                {isCustomMode ? t('ManualInputOn') : t('ManualInputOff')}
              </TextButton>
            </div>
            {isCustomMode ? (
              <input
                className="w-full rounded-lg bg-white px-4 py-2 text-black hover:bg-gray-100"
                value={timestampTimeZone}
                onChange={(event) =>
                  settingsStore.setState({
                    timestampTimeZone: event.target.value,
                  })
                }
                placeholder={t('TimestampTimeZonePlaceholder')}
              />
            ) : (
              <select
                className="w-full rounded-lg bg-white px-4 py-2 text-black hover:bg-gray-100"
                value={timestampTimeZone}
                onChange={(event) =>
                  settingsStore.setState({
                    timestampTimeZone: event.target.value,
                  })
                }
              >
                {timeZoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
export default AdvancedSettings
