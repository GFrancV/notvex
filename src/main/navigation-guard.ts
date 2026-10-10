import { app, shell } from 'electron'

import { isSafeExternalUrl } from './url-guard'

// Any page a webContents loads gets the preload's window.notvex, and the
// renderer is a SPA that never navigates, so no webContents may navigate,
// attach a <webview> or open a window. Installed app-wide so a window or view
// added later is guarded from birth instead of relying on its author.
export function installNavigationGuard(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Covers a dropped file too, which navigates to file:// by default. A
    // renderer-initiated reload (location.reload(), Vite's full reload) is
    // blocked as well; Ctrl+R and HMR module swaps don't navigate from the
    // renderer, so they still work.
    contents.on('will-navigate', (event) => event.preventDefault())
    // will-navigate only sees the main frame; this also stops subframes.
    contents.on('will-frame-navigate', (event) => event.preventDefault())
    contents.on('will-attach-webview', (event) => event.preventDefault())

    // External links open in the system browser, not in-app — http(s) only
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}
