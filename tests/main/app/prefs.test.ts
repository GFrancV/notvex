import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Prefs } from '@shared/types'

// prefs.json is a plain file anyone can edit, so a value read back from it is untrusted too.

const fsState = vi.hoisted(() => ({ contents: '' }))
const fsMock = vi.hoisted(() => ({ writeFileSync: vi.fn(), renameSync: vi.fn() }))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('fs', () => ({
  existsSync: () => true,
  readFileSync: () => fsState.contents,
  writeFileSync: fsMock.writeFileSync,
  renameSync: fsMock.renameSync
}))

const {
  clearRecoveryUnconfirmed,
  getPrefs,
  isPrefKey,
  isRecoveryUnconfirmed,
  markRecoveryUnconfirmed,
  recordVaultUsed,
  scrubLegacyPrefs,
  setPrefs
} = await import('@main/prefs/prefs')

const PREFS_PATH = join('/user-data', 'prefs.json')
const TMP_PATH = `${PREFS_PATH}.tmp`

afterEach(() => {
  fsState.contents = ''
  vi.resetAllMocks()
})

describe('setPrefs', () => {
  it('writes to a temp file and renames it over prefs.json', () => {
    setPrefs({ autoLockMinutes: 5 })

    expect(fsMock.writeFileSync).toHaveBeenCalledExactlyOnceWith(TMP_PATH, expect.any(String))
    expect(JSON.parse(fsMock.writeFileSync.mock.calls[0][1])).toMatchObject({
      autoLockMinutes: 5,
      noteSort: { field: 'updatedAt', direction: 'desc' }
    })
    expect(fsMock.renameSync).toHaveBeenCalledExactlyOnceWith(TMP_PATH, PREFS_PATH)
    expect(fsMock.writeFileSync.mock.invocationCallOrder[0]).toBeLessThan(
      fsMock.renameSync.mock.invocationCallOrder[0]
    )
  })

  it('leaves prefs.json untouched when the temp write throws', () => {
    fsMock.writeFileSync.mockImplementation(() => {
      throw new Error('ENOSPC')
    })

    expect(() => setPrefs({ autoLockMinutes: 5 })).toThrow('ENOSPC')
    expect(fsMock.writeFileSync).toHaveBeenCalledExactlyOnceWith(TMP_PATH, expect.any(String))
    expect(fsMock.renameSync).not.toHaveBeenCalled()
  })
})

describe('getPrefs noteSort', () => {
  it('keeps a valid saved sort', () => {
    fsState.contents = JSON.stringify({ noteSort: { field: 'title', direction: 'asc' } })
    expect(getPrefs().noteSort).toEqual({ field: 'title', direction: 'asc' })
  })

  it('uses the default for a prefs.json written before noteSort existed', () => {
    fsState.contents = JSON.stringify({ autoLockMinutes: 5 })
    expect(getPrefs().noteSort).toEqual({ field: 'updatedAt', direction: 'desc' })
  })

  it.each([
    ['an unknown field', { field: 'xyz', direction: 'asc' }],
    ['an unknown direction', { field: 'title', direction: 'sideways' }],
    ['a non-object', 'title']
  ])('falls back to the default for %s', (_label, noteSort) => {
    fsState.contents = JSON.stringify({ noteSort })
    expect(getPrefs().noteSort).toEqual({ field: 'updatedAt', direction: 'desc' })
  })
})

describe.each(['checkUpdatesOnStartup', 'clearClipboardOnLock'] as const)('getPrefs %s', (key) => {
  it('keeps a saved false', () => {
    fsState.contents = JSON.stringify({ [key]: false })
    expect(getPrefs()[key]).toBe(false)
  })

  it('defaults to true for a prefs.json written before the pref existed', () => {
    fsState.contents = JSON.stringify({ autoLockMinutes: 5 })
    expect(getPrefs()[key]).toBe(true)
  })

  it.each([
    ['a string', 'no'],
    ['a number', 0],
    ['null', null]
  ])('falls back to true for %s', (_label, value) => {
    fsState.contents = JSON.stringify({ [key]: value })
    expect(getPrefs()[key]).toBe(true)
  })
})

// Valid values exclude the default, which a fallback would also return.
describe.each<[keyof Prefs, unknown[], unknown, unknown[]]>([
  ['clipboardClearSeconds', [0, 10, 30, 120, 300], 60, [-1, 45, '60', 2 ** 31, 1.5, null, true]],
  ['autoLockMinutes', [0, 1, 480], 15, [-1, 481, 1.5, '15', null, true]],
  ['lockOnMinimize', [true], false, ['true', 1]],
  ['allowScreenCapture', [true], false, ['true', 1]]
])('getPrefs %s', (key, valid, fallback, invalid) => {
  it.each(valid)('keeps a saved %j', (value) => {
    fsState.contents = JSON.stringify({ [key]: value })
    expect(getPrefs()[key]).toEqual(value)
  })

  it.each(invalid)('falls back to the default for %j', (value) => {
    fsState.contents = JSON.stringify({ [key]: value })
    expect(getPrefs()[key]).toEqual(fallback)
  })
})

describe('getPrefs', () => {
  it('resets only the invalid key, not the valid ones next to it', () => {
    fsState.contents = JSON.stringify({ autoLockMinutes: 5, clipboardClearSeconds: -1 })
    expect(getPrefs()).toMatchObject({ autoLockMinutes: 5, clipboardClearSeconds: 60 })
  })

  it.each(['"abc"', '[1]', 'null', '5'])('reads a top-level %s as the defaults', (contents) => {
    fsState.contents = contents
    expect(getPrefs()).toEqual({
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
    })
  })
})

describe('setPrefs after an invalid read', () => {
  it('writes the cleaned values, not the invalid ones from prefs.json', () => {
    fsState.contents = JSON.stringify({ autoLockMinutes: -1 })
    setPrefs({ lockOnMinimize: true })

    expect(JSON.parse(fsMock.writeFileSync.mock.calls[0][1])).toMatchObject({
      autoLockMinutes: 15,
      lockOnMinimize: true
    })
  })
})

describe('getPrefs recentVaults', () => {
  const vault = { path: '/vaults/a.nvx', lastOpenedAt: 1 }

  it('keeps well-formed entries', () => {
    fsState.contents = JSON.stringify({ recentVaults: [vault] })
    expect(getPrefs().recentVaults).toEqual([vault])
  })

  it.each([
    ['a string', 'x'],
    ['an object', {}],
    ['null', null]
  ])('falls back to an empty list for %s', (_label, recentVaults) => {
    fsState.contents = JSON.stringify({ recentVaults })
    expect(getPrefs().recentVaults).toEqual([])
  })

  it('drops malformed entries and keeps the valid ones', () => {
    fsState.contents = JSON.stringify({
      recentVaults: [vault, { path: 1 }, null, 'x', { path: '/vaults/b.nvx' }]
    })
    expect(getPrefs().recentVaults).toEqual([vault])
  })

  it('drops an entry with an empty path', () => {
    fsState.contents = JSON.stringify({ recentVaults: [{ ...vault, path: '' }, vault] })
    expect(getPrefs().recentVaults).toEqual([vault])
  })

  it.each([
    ['a UNC path', '\\\\host\\share\\v.nvx'],
    ['a forward-slash UNC path', '//host/share/v.nvx'],
    ['a device path', '\\\\?\\C:\\v.nvx'],
    ['a relative path', 'v.nvx']
  ])('drops an entry with %s', (_label, path) => {
    fsState.contents = JSON.stringify({ recentVaults: [{ ...vault, path }, vault] })
    expect(getPrefs().recentVaults).toEqual([vault])
  })

  it('keeps only the two known fields of an entry', () => {
    fsState.contents = JSON.stringify({ recentVaults: [{ ...vault, extra: 1 }] })
    expect(getPrefs().recentVaults).toStrictEqual([vault])
  })

  it('drops the legacy hasKeyFile field and keeps the entries in the same order', () => {
    const second = { path: '/vaults/b.nvx', lastOpenedAt: 0 }
    fsState.contents = JSON.stringify({
      recentVaults: [
        { ...vault, hasKeyFile: true },
        { ...second, hasKeyFile: false }
      ]
    })
    expect(getPrefs().recentVaults).toStrictEqual([vault, second])
  })

  it('keeps only the first 5 entries', () => {
    const vaults = Array.from({ length: 7 }, (_, i) => ({ ...vault, path: `/vaults/${i}.nvx` }))
    fsState.contents = JSON.stringify({ recentVaults: vaults })
    expect(getPrefs().recentVaults).toEqual(vaults.slice(0, 5))
  })
})

describe('recordVaultUsed', () => {
  it('writes the entry without any key-file field', () => {
    recordVaultUsed('/vaults/a.nvx')

    const written = JSON.parse(fsMock.writeFileSync.mock.calls[0][1])
    expect(written.recentVaults).toStrictEqual([
      { path: '/vaults/a.nvx', lastOpenedAt: expect.any(Number) }
    ])
  })
})

describe('scrubLegacyPrefs', () => {
  it('rewrites prefs.json without hasKeyFile, keeping the list order', () => {
    fsState.contents = JSON.stringify({
      recentVaults: [
        { path: '/vaults/b.nvx', hasKeyFile: true, lastOpenedAt: 2 },
        { path: '/vaults/a.nvx', hasKeyFile: false, lastOpenedAt: 1 }
      ]
    })

    scrubLegacyPrefs()

    expect(fsMock.writeFileSync).toHaveBeenCalledExactlyOnceWith(TMP_PATH, expect.any(String))
    const written = fsMock.writeFileSync.mock.calls[0][1]
    expect(written).not.toContain('hasKeyFile')
    expect(JSON.parse(written).recentVaults).toStrictEqual([
      { path: '/vaults/b.nvx', lastOpenedAt: 2 },
      { path: '/vaults/a.nvx', lastOpenedAt: 1 }
    ])
    expect(fsMock.renameSync).toHaveBeenCalledExactlyOnceWith(TMP_PATH, PREFS_PATH)
  })

  it('does not write when no entry carries the field', () => {
    fsState.contents = JSON.stringify({
      recentVaults: [{ path: '/vaults/a.nvx', lastOpenedAt: 1 }]
    })

    scrubLegacyPrefs()

    expect(fsMock.writeFileSync).not.toHaveBeenCalled()
    expect(fsMock.renameSync).not.toHaveBeenCalled()
  })

  it('does not throw when the rewrite fails', () => {
    fsState.contents = JSON.stringify({
      recentVaults: [{ path: '/vaults/a.nvx', hasKeyFile: true, lastOpenedAt: 1 }]
    })
    fsMock.writeFileSync.mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => scrubLegacyPrefs()).not.toThrow()
    expect(console.error).toHaveBeenCalledExactlyOnceWith('prefs: legacy scrub failed:', 'EACCES')
  })
})

describe('getPrefs unconfirmedRecoveryVaults', () => {
  it('keeps the stored paths', () => {
    fsState.contents = JSON.stringify({ unconfirmedRecoveryVaults: ['/vaults/a.nvx'] })
    expect(getPrefs().unconfirmedRecoveryVaults).toEqual(['/vaults/a.nvx'])
  })

  it.each([
    ['a string', 'x'],
    ['an object', {}],
    ['null', null]
  ])('falls back to an empty list for %s', (_label, unconfirmedRecoveryVaults) => {
    fsState.contents = JSON.stringify({ unconfirmedRecoveryVaults })
    expect(getPrefs().unconfirmedRecoveryVaults).toEqual([])
  })

  it('drops entries that are not non-empty strings', () => {
    fsState.contents = JSON.stringify({
      unconfirmedRecoveryVaults: ['/vaults/a.nvx', '', 1, null, {}]
    })
    expect(getPrefs().unconfirmedRecoveryVaults).toEqual(['/vaults/a.nvx'])
  })

  it('is not a renderer-writable key', () => {
    expect(isPrefKey('unconfirmedRecoveryVaults')).toBe(false)
  })
})

describe('getPrefs updateSnooze', () => {
  it('keeps a well-formed snooze', () => {
    fsState.contents = JSON.stringify({ updateSnooze: { version: '1.2.3', until: 1700000000000 } })
    expect(getPrefs().updateSnooze).toEqual({ version: '1.2.3', until: 1700000000000 })
  })

  it.each([
    ['a string', 'x'],
    ['an array', [1]],
    ['a missing version', { until: 1700000000000 }],
    ['an empty version', { version: '', until: 1700000000000 }],
    ['a string expiry', { version: '1.2.3', until: '2026-11-16' }],
    ['a non-finite expiry', { version: '1.2.3', until: null }],
    ['an extra field', { version: '1.2.3', until: 1700000000000, extra: true }]
  ])('falls back to no snooze for %s', (_label, updateSnooze) => {
    fsState.contents = JSON.stringify({ updateSnooze })
    expect(getPrefs().updateSnooze).toBeNull()
  })

  it('is not a renderer-writable key', () => {
    expect(isPrefKey('updateSnooze')).toBe(false)
  })
})

describe('recovery-unconfirmed helpers', () => {
  function written(): Prefs {
    return JSON.parse(fsMock.writeFileSync.mock.calls.at(-1)![1] as string) as Prefs
  }

  it('mark adds the path once', () => {
    fsState.contents = JSON.stringify({ unconfirmedRecoveryVaults: ['/vaults/b.nvx'] })
    markRecoveryUnconfirmed('/vaults/a.nvx')
    expect(written().unconfirmedRecoveryVaults).toEqual(['/vaults/b.nvx', '/vaults/a.nvx'])
  })

  it('mark skips the write when the path is already there', () => {
    fsState.contents = JSON.stringify({ unconfirmedRecoveryVaults: ['/vaults/a.nvx'] })
    markRecoveryUnconfirmed('/vaults/a.nvx')
    expect(fsMock.writeFileSync).not.toHaveBeenCalled()
  })

  it('clear removes only that path', () => {
    fsState.contents = JSON.stringify({
      unconfirmedRecoveryVaults: ['/vaults/a.nvx', '/vaults/b.nvx']
    })
    clearRecoveryUnconfirmed('/vaults/a.nvx')
    expect(written().unconfirmedRecoveryVaults).toEqual(['/vaults/b.nvx'])
  })

  it('clear skips the write when the path is not there', () => {
    fsState.contents = JSON.stringify({ unconfirmedRecoveryVaults: ['/vaults/b.nvx'] })
    clearRecoveryUnconfirmed('/vaults/a.nvx')
    expect(fsMock.writeFileSync).not.toHaveBeenCalled()
  })

  it('isRecoveryUnconfirmed reflects the stored list', () => {
    fsState.contents = JSON.stringify({ unconfirmedRecoveryVaults: ['/vaults/a.nvx'] })
    expect(isRecoveryUnconfirmed('/vaults/a.nvx')).toBe(true)
    expect(isRecoveryUnconfirmed('/vaults/b.nvx')).toBe(false)
  })

  it.runIf(process.platform === 'win32')('matches paths case-insensitively on Windows', () => {
    fsState.contents = JSON.stringify({ unconfirmedRecoveryVaults: ['C:\\Vaults\\A.nvx'] })
    expect(isRecoveryUnconfirmed('c:\\vaults\\a.nvx')).toBe(true)
    clearRecoveryUnconfirmed('c:\\vaults\\a.nvx')
    expect(written().unconfirmedRecoveryVaults).toEqual([])
  })
})

describe('getPrefs with every pref invalid', () => {
  it('reads back exactly the defaults', () => {
    fsState.contents = JSON.stringify({
      recentVaults: 'x',
      unconfirmedRecoveryVaults: 'x',
      autoLockMinutes: -1,
      allowScreenCapture: 'y',
      lockOnMinimize: 1,
      clipboardClearSeconds: 45,
      clearClipboardOnLock: null,
      noteSort: 'title',
      checkUpdatesOnStartup: 0,
      updateSnooze: 'x'
    })
    expect(getPrefs()).toEqual({
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
    })
  })
})
