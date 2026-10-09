import { afterEach, describe, expect, it, vi } from 'vitest'

// prefs.json is a plain file anyone can edit, so a value read back from it is untrusted too.

const fsState = vi.hoisted(() => ({ contents: '' }))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('fs', () => ({
  existsSync: () => true,
  readFileSync: () => fsState.contents,
  writeFileSync: vi.fn()
}))

const { getPrefs } = await import('@main/prefs')

afterEach(() => {
  fsState.contents = ''
})

describe('getPrefs noteSort', () => {
  it('keeps a valid saved sort', () => {
    fsState.contents = JSON.stringify({ noteSort: { field: 'title', direction: 'asc' } })
    expect(getPrefs().noteSort).toEqual({ field: 'title', direction: 'asc' })
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
