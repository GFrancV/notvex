import { session } from 'electron'

// Electron grants every permission request when no handler is set. The renderer
// only ever needs clipboard write, for navigator.clipboard.writeText.
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

export function installPermissionGuard(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  )
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
}
