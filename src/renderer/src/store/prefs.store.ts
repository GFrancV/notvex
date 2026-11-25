import { create } from 'zustand'

import { notvex } from '@/lib/ipc'
import type { NoteSort, Prefs, RecentVault } from '@shared/types'

type SettingKey = keyof Omit<Prefs, 'recentVaults' | 'unconfirmedRecoveryVaults' | 'updateSnooze'>

interface PrefsStore {
  ready: boolean
  autoLockMinutes: number
  allowScreenCapture: boolean
  lockOnMinimize: boolean
  clipboardClearSeconds: number
  clearClipboardOnLock: boolean
  noteSort: NoteSort
  checkUpdatesOnStartup: boolean
  privacyMode: boolean
  recentVaults: RecentVault[]
  load: () => Promise<void>
  /** Shows the value at once and saves it; reverts and resolves false if the save fails. */
  setPref: <K extends SettingKey>(key: K, value: Prefs[K]) => Promise<boolean>
}

export const usePrefsStore = create<PrefsStore>((set, get) => ({
  ready: false,
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  clipboardClearSeconds: 60,
  clearClipboardOnLock: true,
  noteSort: { field: 'updatedAt', direction: 'desc' },
  checkUpdatesOnStartup: true,
  privacyMode: false,
  recentVaults: [],

  load: async () => {
    const res = await notvex.prefs.get()
    if (res.success && res.data && typeof res.data === 'object') {
      const p = res.data
      set({
        ready: true,
        autoLockMinutes: p.autoLockMinutes,
        allowScreenCapture: p.allowScreenCapture,
        lockOnMinimize: p.lockOnMinimize,
        clipboardClearSeconds: p.clipboardClearSeconds,
        clearClipboardOnLock: p.clearClipboardOnLock,
        noteSort: p.noteSort,
        checkUpdatesOnStartup: p.checkUpdatesOnStartup,
        privacyMode: p.privacyMode,
        recentVaults: p.recentVaults
      })
    } else {
      set({ ready: true })
    }
  },

  setPref: async (key, value) => {
    const previous = get()[key]
    set({ [key]: value })
    try {
      // prefs:set reports a rejected or failed write in its result rather than throwing.
      if ((await notvex.prefs.set(key, value)).success) return true
    } catch {
      // IPC itself failed: same outcome as a failed write.
    }
    set({ [key]: previous })
    return false
  }
}))
