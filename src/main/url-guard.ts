import type { IpcMainInvokeEvent } from 'electron'
import { app } from 'electron'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The page a packaged build loads. Shared with window.ts so the IPC sender
// check below compares against exactly what the window loaded.
export const rendererIndexPath = join(import.meta.dirname, '../renderer/index.html')

// Chromium and Node can spell the same file URL differently (percent-escapes,
// Windows drive-letter case), so frames are matched by path, not by string.
// Windows paths are case-insensitive.
function pathKey(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}
const rendererIndexKey = pathKey(rendererIndexPath)

// The Vite dev server, in a dev build only. The bundle still reads the env var
// at runtime, so an installed app launched with it set must not load (or
// trust) whatever page it points at (#57).
export function devRendererUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
}

// The one scheme check for every route that hands a URL to the OS
// (shell:open-external and setWindowOpenHandler), so they can't drift (#56).
// IPC arguments are untyped at runtime, hence the string check.
export function isSafeExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

// Whether an IPC call comes from the app's own page. Any page the window loads
// gets the preload's API, and a navigation keeps the same WebContents, so the
// calling frame's URL is the only thing that tells them apart (#57). A null
// frame (destroyed or navigated away) is never trusted.
export function isTrustedFrame(event: IpcMainInvokeEvent): boolean {
  try {
    const url = new URL(event.senderFrame?.url ?? '')
    const devUrl = devRendererUrl()
    if (devUrl) return url.origin === new URL(devUrl).origin
    // fileURLToPath throws on any non-file: URL and ignores #hash and ?query; a
    // remote file host becomes a UNC path, which never matches.
    return pathKey(fileURLToPath(url)) === rendererIndexKey
  } catch {
    return false
  }
}
