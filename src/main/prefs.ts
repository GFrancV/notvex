import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { app } from 'electron'

export interface Prefs {
  vaultPath: string | null
  autoLockMinutes: number
  allowScreenCapture: boolean
  lockOnMinimize: boolean
}

const DEFAULTS: Prefs = {
  vaultPath: null,
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

export function getPrefs(): Prefs {
  const path = prefsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<Prefs>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const updated = { ...getPrefs(), ...patch }
  writeFileSync(prefsPath(), JSON.stringify(updated, null, 2))
  return updated
}

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return getPrefs()[key]
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  setPrefs({ [key]: value })
}
