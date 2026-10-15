/** `museai` namespace dictionaries for the MuseAI standalone view. */

/** Dictionary namespace owned by this app. */
export const NS = 'museai'

/** English dictionary (translated from the tavern plugin; zh intentionally dropped). */
export const en = {
  'tab.label': 'MuseAI',
  'nav.background': 'Background',
  'nav.chat': 'Chat',
  'nav.adventure': 'Adventure',
  'nav.bond': 'Bond',
  'nav.settings': 'Settings',
  'view.title': 'MuseAI',
  'view.subtitle': 'Background · Chat · Adventure · Bond · Settings',
} satisfies Record<string, string>

/** The museai namespace key union. */
export type MuseAIKey = keyof typeof en
