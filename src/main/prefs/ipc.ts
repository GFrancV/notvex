import type { Prefs } from '@shared/types'
import { fail, handle, ok } from '../ipc/core'
import { getPrefs, isPrefKey, isValidPref, removeRecentVault, setPref } from './prefs'

export function registerPrefsHandlers(): void {
  handle('prefs:get', () => {
    try {
      return ok(getPrefs())
    } catch (e) {
      return fail(e)
    }
  })

  handle('prefs:set', (_e, key: keyof Prefs, value: Prefs[keyof Prefs]) => {
    try {
      if (!isPrefKey(key)) return fail(`Unknown preference key: ${key}`)
      if (!isValidPref(key, value)) return fail(`Invalid value for preference: ${key}`)

      setPref(key, value)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('prefs:remove-recent-vault', (_e, filePath: unknown) => {
    try {
      if (typeof filePath !== 'string' || filePath === '') {
        return fail("Couldn't remove this vault from the list")
      }
      removeRecentVault(filePath)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })
}
