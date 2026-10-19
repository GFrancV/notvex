import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'
import { PRESET_COLORS } from '@shared/types'

// The main process is the trust boundary for tag names and colors: the renderer's maxLength and
// color picker only limit what the UI offers. Only what importing ipc-handlers.ts and the tag
// handlers touch is mocked.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {},
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))
vi.mock('@main/prefs', () => ({ getPref: vi.fn(() => 0) }))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({
  getDb: vi.fn(() => ({})),
  isVaultOpen: vi.fn(() => true),
  withVaultLock: vi.fn(<T>(fn: () => Promise<T>) => fn())
}))
vi.mock('@main/db/queries', () => ({
  createTag: vi.fn(async () => ({ id: 't1' })),
  createTagAndAssign: vi.fn(async () => ({ id: 't1' })),
  listTags: vi.fn(async () => []),
  updateTag: vi.fn(async () => undefined)
}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { createTag, createTagAndAssign, listTags, updateTag } = await import('@main/db/queries')
const { isVaultOpen, withVaultLock } = await import('@main/vault/vault')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

// Each channel takes the name in a different argument; `call` builds them from the name alone.
const channels = [
  {
    channel: 'tags:create',
    call: (name: unknown) => invoke('tags:create', { name, color: '#10b981' }),
    query: createTag,
    nameSent: () => vi.mocked(createTag).mock.calls[0][1].name
  },
  {
    channel: 'tags:create-and-assign',
    call: (name: unknown) =>
      invoke('tags:create-and-assign', { noteId: 'n1', name, color: '#10b981' }),
    query: createTagAndAssign,
    nameSent: () => vi.mocked(createTagAndAssign).mock.calls[0][1].name
  },
  {
    channel: 'tags:update',
    call: (name: unknown) => invoke('tags:update', 't1', { name }),
    query: updateTag,
    nameSent: () => vi.mocked(updateTag).mock.calls[0][2].name
  }
]

const EMPTY = { success: false, error: 'Tag name cannot be empty' }
const TOO_LONG = { success: false, error: 'Tag name must be at most 24 characters' }

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks keeps queued *Once values; an unconsumed one would leak into the next test.
  vi.mocked(isVaultOpen).mockReset()
  registerIpcHandlers({} as BrowserWindow, () => null)
})

afterEach(() => stopAutoLockTimer())

describe.each(channels)('$channel tag name validation', ({ call, query, nameSent }) => {
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['non-string', 42],
    ['null', null]
  ])('rejects a %s name before taking the vault lock', async (_label, name) => {
    expect(await call(name)).toEqual(EMPTY)
    expect(withVaultLock).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a name over the limit before taking the vault lock', async () => {
    expect(await call('a'.repeat(25))).toEqual(TOO_LONG)
    expect(withVaultLock).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('reports a locked vault before judging the name', async () => {
    vi.mocked(isVaultOpen).mockReturnValueOnce(false)
    expect(await call('a'.repeat(25))).toEqual({ success: false, error: 'Vault is locked' })
    expect(query).not.toHaveBeenCalled()
  })

  it('accepts a name of exactly the limit', async () => {
    expect(await call('a'.repeat(24))).toMatchObject({ success: true })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('stores the trimmed name, so surrounding spaces do not count toward the limit', async () => {
    expect(await call(`  ${'a'.repeat(24)}  `)).toMatchObject({ success: true })
    expect(nameSent()).toBe('a'.repeat(24))
  })
})

const createChannels = [
  {
    channel: 'tags:create',
    call: (name: unknown, color: unknown) => invoke('tags:create', { name, color }),
    query: createTag,
    colorSent: () => vi.mocked(createTag).mock.calls[0][1].color
  },
  {
    channel: 'tags:create-and-assign',
    call: (name: unknown, color: unknown) =>
      invoke('tags:create-and-assign', { noteId: 'n1', name, color }),
    query: createTagAndAssign,
    colorSent: () => vi.mocked(createTagAndAssign).mock.calls[0][1].color
  }
]

const BAD_COLOR = { success: false, error: 'Tag color must be a #rrggbb hex value' }

const INVALID_COLORS: [string, unknown][] = [
  ['a color name', 'red'],
  ['a 3-digit hex', '#fff'],
  ['a 5-digit hex', '#10b98'],
  ['a 7-digit hex', '#10b9811'],
  ['an 8-digit hex with alpha', '#10b98126'],
  ['non-hex digits', '#gggggg'],
  ['a padded hex', ' #10b981'],
  ['a CSS function', 'url(x)'],
  ['a number', 42],
  ['null', null],
  ['a missing color', undefined]
]

describe.each(createChannels)('$channel tag color validation', ({ call, query, colorSent }) => {
  it.each(INVALID_COLORS)('rejects %s before taking the vault lock', async (_label, color) => {
    expect(await call('work', color)).toEqual(BAD_COLOR)
    expect(withVaultLock).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it.each(PRESET_COLORS)('stores the preset %s unchanged', async (color) => {
    expect(await call('work', color)).toMatchObject({ success: true })
    expect(colorSent()).toBe(color)
  })

  it('stores a custom hex lower-cased', async () => {
    expect(await call('work', '#ABCdef')).toMatchObject({ success: true })
    expect(colorSent()).toBe('#abcdef')
  })

  it('reports a locked vault before judging the color', async () => {
    vi.mocked(isVaultOpen).mockReturnValueOnce(false)
    expect(await call('work', 'red')).toEqual({ success: false, error: 'Vault is locked' })
    expect(query).not.toHaveBeenCalled()
  })

  it('reports an invalid name before an invalid color', async () => {
    expect(await call('', 'red')).toEqual(EMPTY)
  })
})

describe('tags:update without a name', () => {
  it('passes a color-only patch through unchanged', async () => {
    const patch = { color: '#3b82f6' }
    expect(await invoke('tags:update', 't1', patch)).toEqual({ success: true, data: null })
    expect(updateTag).toHaveBeenCalledWith(expect.anything(), 't1', patch)
  })
})

describe('tags:update tag color validation', () => {
  // An undefined color on update means "leave it unchanged", so it is not an invalid value here.
  const invalid = INVALID_COLORS.filter(([, color]) => color !== undefined)

  it.each(invalid)('rejects %s before taking the vault lock', async (_label, color) => {
    expect(await invoke('tags:update', 't1', { color })).toEqual(BAD_COLOR)
    expect(withVaultLock).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('stores a custom hex lower-cased', async () => {
    expect(await invoke('tags:update', 't1', { color: '#ABCdef' })).toMatchObject({
      success: true
    })
    expect(vi.mocked(updateTag).mock.calls[0][2].color).toBe('#abcdef')
  })

  it('sends a name-only patch without a color key', async () => {
    expect(await invoke('tags:update', 't1', { name: 'work' })).toMatchObject({ success: true })
    expect(vi.mocked(updateTag).mock.calls[0][2]).not.toHaveProperty('color')
  })

  it('reports a locked vault before judging the color', async () => {
    vi.mocked(isVaultOpen).mockReturnValueOnce(false)
    expect(await invoke('tags:update', 't1', { color: 'red' })).toEqual({
      success: false,
      error: 'Vault is locked'
    })
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('reports an invalid name before an invalid color', async () => {
    expect(await invoke('tags:update', 't1', { name: '', color: 'red' })).toEqual(EMPTY)
  })

  it('rejects a valid name paired with an invalid color', async () => {
    expect(await invoke('tags:update', 't1', { name: 'work', color: '#fff' })).toEqual(BAD_COLOR)
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('normalizes the name and the color of one patch together', async () => {
    const patch = { name: '  work ', color: '#ABCDEF' }
    expect(await invoke('tags:update', 't1', patch)).toEqual({ success: true, data: null })
    expect(updateTag).toHaveBeenCalledWith(expect.anything(), 't1', {
      name: 'work',
      color: '#abcdef'
    })
  })
})

describe('tags:list', () => {
  it('returns stored tags whose colors predate validation unchanged', async () => {
    const stored = [
      { id: 't1', name: 'old', color: 'red', createdAt: 0 },
      { id: 't2', name: 'upper', color: '#FFF', createdAt: 0 }
    ]
    vi.mocked(listTags).mockResolvedValueOnce(stored)
    expect(await invoke('tags:list')).toEqual({ success: true, data: stored })
  })
})
