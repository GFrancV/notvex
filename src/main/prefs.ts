import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export interface Prefs {
  vaultDir: string | null
  autoLockMinutes: number
  showPreview: boolean
}

const DEFAULTS: Prefs = {
  vaultDir: null,
  autoLockMinutes: 15,
  showPreview: false,
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

export function getPrefs(): Prefs {
  const path = prefsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(path, 'utf8')) }
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
  setPrefs({ [key]: value } as Partial<Prefs>)
}
