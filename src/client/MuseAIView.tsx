/**
 * The MuseAI conversation view: a shell with five internal pages —
 * Background / Chat / Adventure / Bond / Settings — one-at-a-time.
 *
 * Standalone build: no DSH framework props, no PropsLocale. All labels come
 * from the bundled English dictionary.
 */
import { useEffect, useState } from 'react'
import { Tabs } from 'antd'
import { en, type MuseAIKey } from './locales'
import { injectMuseaiStyles } from './styles'
import '../museai.app.css'
import { BackgroundPage } from './pages/Background'
import { ChatPage } from './pages/Chat'
import { AdventurePage } from './pages/Adventure'
import { BondPage } from './pages/Bond'
import { SettingsPage } from './pages/Settings'

/** English label lookup for a museai key. */
const t = (key: MuseAIKey): string => en[key]

const PAGE_TABS: readonly { key: string; labelKey: MuseAIKey }[] = [
  { key: 'background', labelKey: 'nav.background' },
  { key: 'chat', labelKey: 'nav.chat' },
  { key: 'adventure', labelKey: 'nav.adventure' },
  { key: 'bond', labelKey: 'nav.bond' },
  { key: 'settings', labelKey: 'nav.settings' },
]

/** The MuseAI app shell: header tabs + scrollable page area. */
export function MuseAIView(): JSX.Element {
  const [active, setActive] = useState('background')

  useEffect(() => {
    injectMuseaiStyles()
    document.documentElement.classList.add('museai-view-active')
    return () => {
      document.documentElement.classList.remove('museai-view-active')
    }
  }, [])

  return (
    <div className="museai-view-root">
      <Tabs
        className="museai-tabs"
        activeKey={active}
        onChange={setActive}
        items={PAGE_TABS.map(({ key, labelKey }) => ({
          key,
          label: t(labelKey),
        }))}
      />
      <div className="museai-view-content">
        {active === 'background' && <BackgroundPage />}
        {active === 'chat' && <ChatPage />}
        {active === 'adventure' && <AdventurePage />}
        {active === 'bond' && <BondPage />}
        {active === 'settings' && <SettingsPage />}
      </div>
    </div>
  )
}
