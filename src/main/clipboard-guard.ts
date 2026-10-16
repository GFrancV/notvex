import { clipboard, ClipboardItem } from 'electron'

import { logError } from './log'
import { getPrefs } from './prefs'

// The recovery phrase grants full access, so it is cleared even when the user turned the
// auto-clear off.
const SECRET_CLEAR_SECONDS = 30

const windowsFormat = (name: string): string => `electron application/osclipboard;format="${name}"`
const dwordZero = (): Blob => new Blob([new Uint32Array([0])])

let timer: ReturnType<typeof setTimeout> | undefined

export function scheduleClipboardClear(copiedValue: string, seconds?: number): void {
  if (timer) clearTimeout(timer)

  const delay = seconds ?? getPrefs().clipboardClearSeconds
  if (delay <= 0) return

  timer = setTimeout(() => {
    // readText() is async since Electron 44
    clipboard
      .readText()
      .then((text) => {
        if (text === copiedValue) clipboard.clear()
      })
      .catch((e: unknown) => logError('[clipboard] auto-clear failed:', e))
  }, delay * 1000)
}

// Clipboard history, cloud sync and clipboard managers decide whether to keep an item when it
// is written, so the opt-out markers must ride in the same atomic write as the text.
export async function writeClipboard(text: string, { secret = false } = {}): Promise<void> {
  await clipboard.write([
    new ClipboardItem({
      'text/plain': text,
      [windowsFormat('ExcludeClipboardContentFromMonitorProcessing')]: dwordZero(),
      [windowsFormat('CanIncludeInClipboardHistory')]: dwordZero(),
      [windowsFormat('CanUploadToCloudClipboard')]: dwordZero(),
      'application/x-nspasteboard-concealed-type': '',
      'x-kde-passwordManagerHint': 'secret'
    })
  ])
  scheduleClipboardClear(text, secret ? SECRET_CLEAR_SECONDS : undefined)
}
