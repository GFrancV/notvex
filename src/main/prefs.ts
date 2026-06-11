import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { app } from 'electron'

export interface Prefs {
  vaultPath: string | null
  recentVaultPaths: string[]
  autoLockMinutes: number
  allowScreenCapture: boolean
  lockOnMinimize: boolean
}

const DEFAULTS: Prefs = {
  vaultPath: null,
  recentVaultPaths: [],
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false
}

const MAX_RECENT_VAULTS = 5

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

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

// Single setPrefs call keeps the invariant vaultPath === recentVaultPaths[0]
export function recordVaultUsed(path: string): void {
  const prefs = getPrefs()
  const rest = prefs.recentVaultPaths.filter((p) => !samePath(p, path))
  setPrefs({ vaultPath: path, recentVaultPaths: [path, ...rest].slice(0, MAX_RECENT_VAULTS) })
}
