import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { isAbsolute, join } from 'path'

import type { NoteSort, Prefs, RecentVault } from '@shared/types'

import { logError } from './log'

const DEFAULTS: Prefs = {
  recentVaults: [],
  unconfirmedRecoveryVaults: [],
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  clipboardClearSeconds: 60,
  clearClipboardOnLock: true,
  noteSort: { field: 'updatedAt', direction: 'desc' },
  checkUpdatesOnStartup: true,
  updateSnooze: null
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

export function isLocalVaultPath(p: string): boolean {
  // a leading \\ or // is a UNC path: any fs call on it opens an SMB connection to that host
  return isAbsolute(p) && !/^[\\/]{2}/.test(p)
}

function isUpdateSnooze(v: unknown): v is NonNullable<Prefs['updateSnooze']> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { version, until, ...rest } = v as Record<string, unknown>
  return (
    Object.keys(rest).length === 0 &&
    typeof version === 'string' &&
    version !== '' &&
    typeof until === 'number' &&
    Number.isFinite(until)
  )
}

function isRecentVault(v: unknown): v is RecentVault {
  if (typeof v !== 'object' || v === null) return false
  const { path, lastOpenedAt } = v as Record<string, unknown>
  return typeof path === 'string' && isLocalVaultPath(path) && typeof lastOpenedAt === 'number'
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
} satisfies Record<
  Exclude<keyof Prefs, 'recentVaults' | 'unconfirmedRecoveryVaults' | 'updateSnooze'>,
  (v: unknown) => boolean
>

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
          .map(({ path, lastOpenedAt }) => ({ path, lastOpenedAt }))
      : []
    prefs.unconfirmedRecoveryVaults = Array.isArray(prefs.unconfirmedRecoveryVaults)
      ? prefs.unconfirmedRecoveryVaults.filter((p) => typeof p === 'string' && p !== '')
      : []
    if (!isUpdateSnooze(prefs.updateSnooze)) prefs.updateSnooze = null
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

// Earlier versions stored a per-vault key-file flag in prefs.json. getPrefs ignores it, but the
// bytes stay on disk until the file is rewritten.
// Never throws: a failed cleanup must not stop the app from starting.
export function scrubLegacyPrefs(): void {
  try {
    if (!existsSync(prefsPath())) return
    if (!readFileSync(prefsPath(), 'utf8').includes('"hasKeyFile"')) return
    setPrefs({})
  } catch (e) {
    logError('prefs: legacy scrub failed:', e)
  }
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

export function recordVaultUsed(path: string): void {
  const recentVaults = getPrefs().recentVaults
  const rest = recentVaults.filter((recentVault) => !samePath(recentVault.path, path))

  setPrefs({
    recentVaults: [{ path, lastOpenedAt: Date.now() }, ...rest].slice(0, MAX_RECENT_VAULTS)
  })
}

// Vaults whose current recovery key was issued but never confirmed as saved. Kept outside the
// vault so it survives a lock, quit or crash before the user confirms.
export function isRecoveryUnconfirmed(path: string): boolean {
  return getPrefs().unconfirmedRecoveryVaults.some((p) => samePath(p, path))
}

export function markRecoveryUnconfirmed(path: string): void {
  if (isRecoveryUnconfirmed(path)) return
  setPrefs({ unconfirmedRecoveryVaults: [...getPrefs().unconfirmedRecoveryVaults, path] })
}

export function clearRecoveryUnconfirmed(path: string): void {
  if (!isRecoveryUnconfirmed(path)) return
  setPrefs({
    unconfirmedRecoveryVaults: getPrefs().unconfirmedRecoveryVaults.filter(
      (p) => !samePath(p, path)
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
    recordVaultUsed(vaultPath)
    return
  }

  const rest = recentVaults.filter((v) => !samePath(v.path, vaultPath))
  setPrefs({ recentVaults: [existing, ...rest].slice(0, MAX_RECENT_VAULTS) })
}

export function removeRecentVault(vaultPath: string): void {
  setPrefs({ recentVaults: getPref('recentVaults').filter((v) => !samePath(v.path, vaultPath)) })
}
