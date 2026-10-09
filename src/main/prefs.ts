import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { NoteSort, Prefs } from '@shared/types'

const DEFAULTS: Prefs = {
  recentVaults: [],
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  clipboardClearSeconds: 60,
  noteSort: { field: 'updatedAt', direction: 'desc' }
}

const MAX_RECENT_VAULTS = 5

function prefsPath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

export function isNoteSort(v: unknown): v is NoteSort {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { field, direction, ...rest } = v as Record<string, unknown>
  return (
    Object.keys(rest).length === 0 &&
    ['updatedAt', 'createdAt', 'title'].includes(field as string) &&
    (direction === 'asc' || direction === 'desc')
  )
}

export function getPrefs(): Prefs {
  const path = prefsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const prefs = { ...DEFAULTS, ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<Prefs>) }
    // prefs.json can be hand-edited, so a stored value is as untrusted as one from the renderer.
    if (!isNoteSort(prefs.noteSort)) prefs.noteSort = DEFAULTS.noteSort
    return prefs
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
