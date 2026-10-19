import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// clipboard:write is a trust boundary: the renderer picks the text and whether it is a secret,
// never anything else, so the handler refuses any other shape before it reaches the clipboard.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      handlers.set(channel, fn)
    }
  }
}))

vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('@main/prefs', () => ({ getPref: vi.fn(() => 0) }))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({ isVaultOpen: vi.fn(() => false) }))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({ writeClipboard: vi.fn(async () => undefined) }))
vi.mock('@main/drain-renderer', () => ({}))

const senderFrame = { url: pathToFileURL(rendererIndexPath).href }

function write(...args: unknown[]): Promise<unknown> {
  const fn = handlers.get('clipboard:write')
  if (!fn) throw new Error('no handler for clipboard:write')
  return Promise.resolve(fn({ sender: {}, senderFrame }, ...args))
}

let ipc: typeof import('@main/ipc-handlers')
let writeClipboard: ReturnType<typeof vi.fn>
let isVaultOpen: ReturnType<typeof vi.fn>

beforeEach(async () => {
  handlers.clear()
  vi.resetModules()
  vi.clearAllMocks()
  isVaultOpen = vi.mocked((await import('@main/vault/vault')).isVaultOpen)
  isVaultOpen.mockReturnValue(true)
  writeClipboard = vi.mocked((await import('@main/clipboard-guard')).writeClipboard)
  ipc = await import('@main/ipc-handlers')
  ipc.registerIpcHandlers({ isDestroyed: () => false } as never, () => null)
})

afterEach(() => {
  ipc.stopAutoLockTimer()
})

describe('clipboard:write', () => {
  it('writes plain text as a non-secret', async () => {
    await expect(write('hello')).resolves.toEqual({ success: true, data: null })
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('hello', { secret: false })
  })

  it('passes the secret flag through', async () => {
    await write('words', { secret: true })
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('words', { secret: true })
  })

  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null]
  ])('treats a secret flag that is %s as false', async (_label, secret) => {
    await write('words', { secret })
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('words', { secret: false })
  })

  it('reports a failed clipboard write instead of claiming success', async () => {
    writeClipboard.mockRejectedValueOnce(new Error('clipboard busy'))

    await expect(write('hello')).resolves.toEqual({ success: false, error: 'clipboard busy' })
  })

  it('accepts text up to the size limit', async () => {
    await expect(write('x'.repeat(10_000_000))).resolves.toEqual({ success: true, data: null })
  })

  it.each([
    ['larger than the size limit', 'x'.repeat(10_000_001)],
    ['an empty string', ''],
    ['a number', 42],
    ['an object', { text: 'x' }],
    ['undefined', undefined]
  ])('refuses text that is %s', async (_label, text) => {
    await expect(write(text)).resolves.toEqual({
      success: false,
      error: 'Invalid clipboard value'
    })
    expect(writeClipboard).not.toHaveBeenCalled()
  })

  it('refuses a copy from the unlocked view once the vault is locked', async () => {
    isVaultOpen.mockReturnValue(false)

    await expect(write('note text', { fromUnlockedView: true })).resolves.toEqual({
      success: false,
      error: 'Vault is locked'
    })
    expect(writeClipboard).not.toHaveBeenCalled()
  })

  it('writes a copy from the unlocked view while the vault is open', async () => {
    await expect(write('note text', { fromUnlockedView: true })).resolves.toEqual({
      success: true,
      data: null
    })
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('note text', { secret: false })
  })

  // Setup and Unlock have no vault open, and their fields must still copy and cut.
  it.each([
    ['no flag', undefined],
    ['null options', null],
    ['the flag set to false', { fromUnlockedView: false }],
    ['the flag set to a string', { fromUnlockedView: 'true' }]
  ])('writes a copy with %s while no vault is open', async (_label, opts) => {
    isVaultOpen.mockReturnValue(false)

    await expect(write('password', opts)).resolves.toEqual({ success: true, data: null })
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('password', { secret: false })
  })

  it('still copies the recovery key from the unlocked view with no vault open', async () => {
    isVaultOpen.mockReturnValue(false)

    await expect(write('words', { secret: true, fromUnlockedView: true })).resolves.toEqual({
      success: true,
      data: null
    })
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('words', { secret: true })
  })
})
