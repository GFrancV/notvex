import { clipboard } from 'electron'

import { logError } from './log'
import { getPrefs } from './prefs'

let timer: ReturnType<typeof setTimeout> | undefined

export function scheduleClipboardClear(copiedValue: string): void {
  if (timer) clearTimeout(timer)

  const { clipboardClearSeconds } = getPrefs()
  if (clipboardClearSeconds <= 0) return

  timer = setTimeout(() => {
    // readText() is async since Electron 44
    clipboard
      .readText()
      .then((text) => {
        if (text === copiedValue) clipboard.clear()
      })
      .catch((e: unknown) => logError('[clipboard] auto-clear failed:', e))
  }, clipboardClearSeconds * 1000)
}
