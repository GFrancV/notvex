import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// The startup check is the app's only automatic network request, so the opt-out must hold in
// main no matter what the renderer calls; the manual check stays available either way.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const state = vi.hoisted(() => ({ checkUpdatesOnStartup: true }))
const checkForUpdates = vi.hoisted(() =>
  vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '9.9.9' } }))
)

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

vi.mock('electron-updater', () => ({ autoUpdater: { checkForUpdates } }))
vi.mock('@main/prefs', () => ({
  getPref: vi.fn((key: string) =>
    key === 'checkUpdatesOnStartup' ? state.checkUpdatesOnStartup : 0
  ),
  setPref: vi.fn()
}))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({ isVaultOpen: vi.fn(() => false) }))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const senderFrame = { url: pathToFileURL(rendererIndexPath).href }

function invoke(channel: string): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender: {}, senderFrame }))
}

let ipc: typeof import('@main/ipc-handlers')

beforeEach(async () => {
  handlers.clear()
  vi.resetModules()
  vi.clearAllMocks()
  state.checkUpdatesOnStartup = true
  ipc = await import('@main/ipc-handlers')
  ipc.registerIpcHandlers({ isDestroyed: () => false } as never, () => null)
})

afterEach(() => {
  ipc.stopAutoLockTimer()
})

describe('updater:check-on-startup', () => {
  it('skips the check when the pref is off', async () => {
    state.checkUpdatesOnStartup = false
    await expect(invoke('updater:check-on-startup')).resolves.toEqual({
      success: true,
      data: null
    })
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks when the pref is on', async () => {
    await expect(invoke('updater:check-on-startup')).resolves.toEqual({
      success: true,
      data: '9.9.9'
    })
    expect(checkForUpdates).toHaveBeenCalledOnce()
  })
})

describe('updater:check-now', () => {
  it('checks even when the startup pref is off', async () => {
    state.checkUpdatesOnStartup = false
    await expect(invoke('updater:check-now')).resolves.toEqual({ success: true, data: '9.9.9' })
    expect(checkForUpdates).toHaveBeenCalledOnce()
  })
})
