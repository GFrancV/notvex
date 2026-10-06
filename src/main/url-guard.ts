import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The page a packaged build loads. Shared with window.ts so the IPC sender
// check below compares against exactly what the window loaded.
export const rendererIndexPath = join(import.meta.dirname, '../renderer/index.html')
const rendererIndexUrl = pathToFileURL(rendererIndexPath).href

// The one scheme check for every route that hands a URL to the OS
// (shell:open-external and setWindowOpenHandler), so they can't drift (#56).
export function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

// Whether an IPC call comes from the app's own page. Any page the window loads
// gets the preload's API, and a navigation keeps the same WebContents, so the
// calling frame's URL is the only thing that tells them apart (#57). A null
// frame (destroyed or navigated away) is never trusted.
export function isTrustedFrame(event: IpcMainInvokeEvent): boolean {
  try {
    const url = new URL(event.senderFrame?.url ?? '')
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) return url.origin === new URL(devUrl).origin
    url.hash = ''
    url.search = ''
    return url.href === rendererIndexUrl
  } catch {
    return false
  }
}
