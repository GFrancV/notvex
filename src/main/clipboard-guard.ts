import { clipboard, ClipboardItem } from 'electron'

import { logError } from './log'
import { getPrefs } from './prefs'

// The recovery key grants full access, so it is cleared even when the user turned the
// auto-clear off.
const SECRET_CLEAR_SECONDS = 30

const rawFormat = (name: string): string => `electron application/osclipboard;format="${name}"`
const dwordZero = (): Blob => new Blob([new Uint32Array([0])])

let timer: ReturnType<typeof setTimeout> | undefined
// The secret the armed timer still has to clear; quitting kills the timer, see clearPendingSecret.
let pendingSecret: string | undefined

export function scheduleClipboardClear(copiedValue: string, seconds?: number): void {
  if (timer) clearTimeout(timer)

  const delay = seconds ?? getPrefs().clipboardClearSeconds
  if (delay <= 0) return

  timer = setTimeout(() => {
    pendingSecret = undefined
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
      [rawFormat('ExcludeClipboardContentFromMonitorProcessing')]: dwordZero(),
      [rawFormat('CanIncludeInClipboardHistory')]: dwordZero(),
      [rawFormat('CanUploadToCloudClipboard')]: dwordZero(),
      // Electron drops MIME types it doesn't know, so the pasteboard type goes in raw.
      [rawFormat('org.nspasteboard.ConcealedType')]: '',
      'x-kde-passwordManagerHint': 'secret'
    })
  ])
  // Copying the same secret again (e.g. selecting the words) must not relax its clear.
  const isSecret = secret || text === pendingSecret
  pendingSecret = isSecret ? text : undefined
  scheduleClipboardClear(text, isSecret ? SECRET_CLEAR_SECONDS : undefined)
}

// The clear timer lives in this process, so a secret copied just before quitting would otherwise
// outlive the app. Never throws: it runs on the quit path.
export async function clearPendingSecret(): Promise<void> {
  const secret = pendingSecret
  if (secret === undefined) return
  pendingSecret = undefined
  if (timer) clearTimeout(timer)
  try {
    if ((await clipboard.readText()) === secret) clipboard.clear()
  } catch (e) {
    logError('[clipboard] clearing the pending secret failed:', e)
  }
}
