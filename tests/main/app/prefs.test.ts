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

const { getPrefs, setPrefs } = await import('@main/prefs')

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
      autoLockMinutes: 15,
      allowScreenCapture: false,
      lockOnMinimize: false,
      clipboardClearSeconds: 60,
      clearClipboardOnLock: true,
      noteSort: { field: 'updatedAt', direction: 'desc' },
      checkUpdatesOnStartup: true
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
