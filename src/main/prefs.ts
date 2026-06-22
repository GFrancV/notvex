import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { VaultKeyFileAssociation } from '@shared/types'

export type { VaultKeyFileAssociation }

export interface Prefs {
  vaultPath: string | null
  recentVaultPaths: string[]
  autoLockMinutes: number
  allowScreenCapture: boolean
  lockOnMinimize: boolean
  keyFileAssociations: Record<string, VaultKeyFileAssociation>
}

const DEFAULTS: Prefs = {
  vaultPath: null,
  recentVaultPaths: [],
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  keyFileAssociations: {}
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

export function getKeyFileAssociation(vaultPath: string): VaultKeyFileAssociation | null {
  const associations = getPref('keyFileAssociations')
  const key = Object.keys(associations).find((k) => samePath(k, vaultPath))
  return key ? (associations[key] ?? null) : null
}

export function setKeyFileAssociation(vaultPath: string, hasKeyFile: boolean): void {
  const associations = getPref('keyFileAssociations')
  const key = process.platform === 'win32' ? vaultPath.toLowerCase() : vaultPath
  setPref('keyFileAssociations', { ...associations, [key]: { hasKeyFile } })
}
