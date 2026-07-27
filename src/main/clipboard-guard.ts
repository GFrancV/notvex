import { clipboard } from 'electron'

import { getPrefs } from './prefs'

let timer: ReturnType<typeof setTimeout> | undefined
let armedValue = ''

export function scheduleClipboardClear(copiedValue: string): void {
  if (timer) clearTimeout(timer)

  const { clipboardClearSeconds } = getPrefs()
  if (clipboardClearSeconds <= 0) return

  armedValue = copiedValue
  timer = setTimeout(() => {
    if (clipboard.readText() === armedValue) {
      clipboard.writeText('')
    }
  }, clipboardClearSeconds * 1000)
}
