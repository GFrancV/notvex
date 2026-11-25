import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

import { fail, handle, type IpcResult, ok } from '../ipc/core'
import { getPref } from '../prefs/prefs'
import {
  clearUpdateSilences,
  dismissUpdateForSession,
  downloadUpdate,
  snoozeUpdate
} from './updater'

export function registerUpdaterHandlers(): void {
  const checkForUpdates = async (): Promise<IpcResult<string | null>> => {
    try {
      const result = await autoUpdater.checkForUpdates()
      const available = result?.isUpdateAvailable ?? false
      return ok(available ? (result?.updateInfo.version ?? null) : null)
    } catch (e) {
      return fail(e)
    }
  }

  handle('updater:check-now', () => {
    try {
      clearUpdateSilences()
    } catch (e) {
      return fail(e)
    }
    return checkForUpdates()
  })

  // The opt-out is enforced here, not in the renderer, so a renderer bug can't leak the request.
  // Each check downloads latest.yml from the real release, and its download count is the only
  // signal of how many installs exist, so dev launches must not add to it.
  handle('updater:check-on-startup', () =>
    app.isPackaged && getPref('checkUpdatesOnStartup') ? checkForUpdates() : ok(null)
  )

  handle('updater:snooze', (_e, version: unknown) => {
    if (typeof version !== 'string' || version === '') return fail('Invalid version')
    try {
      snoozeUpdate(version)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('updater:dismiss', (_e, version: unknown) => {
    if (typeof version !== 'string' || version === '') return fail('Invalid version')
    dismissUpdateForSession(version)
    return ok(null)
  })

  handle('updater:download', async () => {
    try {
      await downloadUpdate()
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('updater:install-now', () => {
    try {
      autoUpdater.quitAndInstall(false, true)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('updater:get-current-version', () => {
    try {
      return ok(app.getVersion())
    } catch (e) {
      return fail(e)
    }
  })
}
