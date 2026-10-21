import { clipboard, ClipboardItem } from 'electron'

import { logError } from './log'
import { getPrefs } from './prefs'

// The recovery key grants full access, so it is cleared even when the user turned the
// auto-clear off.
const SECRET_CLEAR_SECONDS = 30

const rawFormat = (name: string): string => `electron application/osclipboard;format="${name}"`
const dwordZero = (): Blob => new Blob([new Uint32Array([0])])

let timer: ReturnType<typeof setTimeout> | undefined
// What locking may still have to clear, see clearClipboardIfOurs.
let lastWritten: string | undefined
// The secret the armed timer still has to clear.
let pendingSecret: string | undefined
// Bumped by every lock, so a write still in flight when a lock cleared can tell it was missed.
let lockGeneration = 0

export function scheduleClipboardClear(copiedValue: string, seconds?: number): void {
  if (timer) clearTimeout(timer)

  const delay = seconds ?? getPrefs().clipboardClearSeconds
  if (delay <= 0) return

  timer = setTimeout(() => {
    lastWritten = pendingSecret = undefined
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
  const generation = lockGeneration
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
  if (generation !== lockGeneration && !isSecret && getPrefs().clearClipboardOnLock) {
    try {
      // Another app may have copied since the write landed; that copy isn't ours to clear.
      if ((await clipboard.readText()) === text) clipboard.clear()
      return
    } catch (e) {
      // Falls through, so the timer or the next lock or quit can still clear it.
      logError('[clipboard] clearing a copy that landed after a lock failed:', e)
    }
  }
  pendingSecret = isSecret ? text : undefined
  lastWritten = text
  scheduleClipboardClear(text, isSecret ? SECRET_CLEAR_SECONDS : undefined)
}

// A locked vault must not leave its content on the clipboard, and the clear timer dies with the
// process, so every lock, quit and crash calls this. Never throws: it runs on those paths.
// The recovery key is shown only once, so a lock leaves it to its 30 s clear: clearing it there
// could wipe it before the user pastes it, with no way to see it again. Quitting kills that
// timer, so quit clears it, regardless of the prefs.
export async function clearClipboardIfOurs(reason: 'lock' | 'quit'): Promise<void> {
  if (reason === 'lock') lockGeneration++
  const ours = lastWritten
  if (ours === undefined) return
  const keep = ours === pendingSecret ? reason === 'lock' : !getPrefs().clearClipboardOnLock
  if (keep) return
  lastWritten = pendingSecret = undefined
  if (timer) clearTimeout(timer)
  try {
    if ((await clipboard.readText()) === ours) clipboard.clear()
  } catch (e) {
    logError('[clipboard] clearing on lock failed:', e)
  }
}
