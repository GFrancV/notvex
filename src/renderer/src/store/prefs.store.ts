import { create } from 'zustand'

import { notvex } from '@/lib/ipc'
import type { Prefs, RecentVault } from '@shared/types'

type SettingKey = keyof Omit<Prefs, 'recentVaults'>

interface PrefsStore {
  ready: boolean
  autoLockMinutes: number
  allowScreenCapture: boolean
  lockOnMinimize: boolean
  clipboardClearSeconds: number
  recentVaults: RecentVault[]
  load: () => Promise<void>
  setPref: <K extends SettingKey>(key: K, value: Prefs[K]) => Promise<void>
  getHasKeyFileForPath: (path: string) => boolean
}

export const usePrefsStore = create<PrefsStore>((set, get) => ({
  ready: false,
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  clipboardClearSeconds: 60,
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
        recentVaults: p.recentVaults
      })
    } else {
      set({ ready: true })
    }
  },

  setPref: async (key, value) => {
    const previous = get()[key]
    try {
      set({ [key]: value })
      await notvex.prefs.set(key, value)
    } catch {
      set({ [key]: previous })
    }
  },

  getHasKeyFileForPath: (path) => {
    const norm = (p: string): string => (notvex.platform === 'win32' ? p.toLowerCase() : p)
    return get().recentVaults.find((v) => norm(v.path) === norm(path))?.hasKeyFile ?? false
  }
}))
