import { session } from 'electron'

// Electron grants every permission request when no handler is set. The renderer needs none:
// even clipboard writes go through main (clipboard-guard.ts).
export function installPermissionGuard(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}
