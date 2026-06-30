import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { Prefs } from '@shared/types'

const DEFAULTS: Prefs = {
  recentVaults: [],
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

export function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function recordVaultUsed(path: string, hasKeyFile: boolean = false): void {
  const recentVaults = getPrefs().recentVaults
  const rest = recentVaults.filter((recentVault) => !samePath(recentVault.path, path))

  setPrefs({
    recentVaults: [{ path, hasKeyFile, lastOpenedAt: Date.now() }, ...rest].slice(
      0,
      MAX_RECENT_VAULTS
    )
  })
}

export function getCurrentVaultPath(): string | null {
  return getPrefs().recentVaults[0]?.path ?? null
}

export function promoteVaultToTop(vaultPath: string): void {
  const recentVaults = getPref('recentVaults')
  const existing = recentVaults.find((v) => samePath(v.path, vaultPath))

  if (!existing) {
    recordVaultUsed(vaultPath, false)
    return
  }

  const rest = recentVaults.filter((v) => !samePath(v.path, vaultPath))
  setPrefs({ recentVaults: [existing, ...rest].slice(0, MAX_RECENT_VAULTS) })
}
