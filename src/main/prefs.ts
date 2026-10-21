import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { NoteSort, Prefs, RecentVault } from '@shared/types'

const DEFAULTS: Prefs = {
  recentVaults: [],
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  clipboardClearSeconds: 60,
  clearClipboardOnLock: true,
  noteSort: { field: 'updatedAt', direction: 'desc' },
  checkUpdatesOnStartup: true
}

const MAX_RECENT_VAULTS = 5

function prefsPath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

function isNoteSort(v: unknown): v is NoteSort {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { field, direction, ...rest } = v as Record<string, unknown>
  return (
    Object.keys(rest).length === 0 &&
    ['updatedAt', 'createdAt', 'title'].includes(field as string) &&
    (direction === 'asc' || direction === 'desc')
  )
}

function isRecentVault(v: unknown): v is RecentVault {
  if (typeof v !== 'object' || v === null) return false
  const { path, hasKeyFile, lastOpenedAt } = v as Record<string, unknown>
  return (
    typeof path === 'string' &&
    path !== '' &&
    typeof hasKeyFile === 'boolean' &&
    typeof lastOpenedAt === 'number'
  )
}

const PREFS_VALIDATORS = {
  autoLockMinutes: (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 480,
  allowScreenCapture: (v: unknown) => typeof v === 'boolean',
  lockOnMinimize: (v: unknown) => typeof v === 'boolean',
  checkUpdatesOnStartup: (v: unknown) => typeof v === 'boolean',
  clearClipboardOnLock: (v: unknown) => typeof v === 'boolean',
  clipboardClearSeconds: (v: unknown) =>
    typeof v === 'number' && [0, 10, 30, 60, 120, 300].includes(v),
  noteSort: isNoteSort
} satisfies Record<Exclude<keyof Prefs, 'recentVaults'>, (v: unknown) => boolean>

// Object.hasOwn, not `in` or a bare lookup: 'toString' or 'constructor' would resolve to
// Object.prototype members and pass as validators.
export function isPrefKey(key: unknown): key is keyof typeof PREFS_VALIDATORS {
  return typeof key === 'string' && Object.hasOwn(PREFS_VALIDATORS, key)
}

export function isValidPref<K extends keyof typeof PREFS_VALIDATORS>(
  key: K,
  value: unknown
): value is Prefs[K] {
  return PREFS_VALIDATORS[key](value)
}

function resetToDefault<K extends keyof Prefs>(prefs: Prefs, key: K): void {
  prefs[key] = DEFAULTS[key]
}

export function getPrefs(): Prefs {
  const path = prefsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const stored: unknown = JSON.parse(readFileSync(path, 'utf8'))
    // a top-level string or array would spread its indices into prefs as keys
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
      return { ...DEFAULTS }
    }
    const prefs = { ...DEFAULTS, ...(stored as Partial<Prefs>) }
    // prefs.json can be hand-edited, so a stored value is as untrusted as one from the renderer.
    for (const key of Object.keys(PREFS_VALIDATORS) as (keyof typeof PREFS_VALIDATORS)[]) {
      if (!isValidPref(key, prefs[key])) resetToDefault(prefs, key)
    }
    prefs.recentVaults = Array.isArray(prefs.recentVaults)
      ? prefs.recentVaults
          .filter(isRecentVault)
          .slice(0, MAX_RECENT_VAULTS)
          .map(({ path, hasKeyFile, lastOpenedAt }) => ({ path, hasKeyFile, lastOpenedAt }))
      : []
    return prefs
  } catch {
    return { ...DEFAULTS }
  }
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const updated = { ...getPrefs(), ...patch }
  const path = prefsPath()
  const tmp = `${path}.tmp`
  // a crash mid-write must leave the old prefs.json, not a truncated one getPrefs reads as defaults
  writeFileSync(tmp, JSON.stringify(updated, null, 2))
  renameSync(tmp, path)
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
