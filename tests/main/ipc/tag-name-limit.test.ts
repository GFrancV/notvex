import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// The main process is the trust boundary for tag names: the renderer's maxLength only limits
// typing. Only what importing ipc-handlers.ts and the tag handlers touch is mocked.

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
  updateTag: vi.fn(async () => undefined)
}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { createTag, createTagAndAssign, updateTag } = await import('@main/db/queries')

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
  registerIpcHandlers({} as BrowserWindow, () => null)
})

afterEach(() => stopAutoLockTimer())

describe.each(channels)('$channel tag name validation', ({ call, query, nameSent }) => {
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['non-string', 42]
  ])('rejects a %s name without touching the DB', async (_label, name) => {
    expect(await call(name)).toEqual(EMPTY)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a name over the limit without touching the DB', async () => {
    expect(await call('a'.repeat(25))).toEqual(TOO_LONG)
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

describe('tags:update without a name', () => {
  it('passes a color-only patch through unchanged', async () => {
    const patch = { color: '#3b82f6' }
    expect(await invoke('tags:update', 't1', patch)).toEqual({ success: true, data: null })
    expect(updateTag).toHaveBeenCalledWith(expect.anything(), 't1', patch)
  })
})
