import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('getPrefs checkUpdatesOnStartup', () => {
  it('keeps a saved false', () => {
    fsState.contents = JSON.stringify({ checkUpdatesOnStartup: false })
    expect(getPrefs().checkUpdatesOnStartup).toBe(false)
  })

  it('defaults to true for a prefs.json written before the pref existed', () => {
    fsState.contents = JSON.stringify({ autoLockMinutes: 5 })
    expect(getPrefs().checkUpdatesOnStartup).toBe(true)
  })

  it.each([
    ['a string', 'no'],
    ['a number', 0],
    ['null', null]
  ])('falls back to true for %s', (_label, checkUpdatesOnStartup) => {
    fsState.contents = JSON.stringify({ checkUpdatesOnStartup })
    expect(getPrefs().checkUpdatesOnStartup).toBe(true)
  })
})
