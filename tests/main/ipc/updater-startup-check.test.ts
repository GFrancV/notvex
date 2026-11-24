import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/security/url-guard'

// The startup check is the app's only automatic network request, so the opt-out must hold in
// main no matter what the renderer calls; the manual check stays available either way. Dev
// builds never run it: each check downloads latest.yml from the real release, and that
// download count is the only signal of how many packaged installs exist.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const state = vi.hoisted(() => ({ checkUpdatesOnStartup: true }))
const app = vi.hoisted(() => ({ isPackaged: true }))
const checkForUpdates = vi.hoisted(() =>
  vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '9.9.9' } }))
)

vi.mock('electron', () => ({
  app,
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      handlers.set(channel, fn)
    }
  }
}))

vi.mock('electron-updater', () => ({ autoUpdater: { checkForUpdates } }))
vi.mock('@main/prefs/prefs', () => ({
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

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender: {}, senderFrame }, ...args))
}

let ipc: typeof import('@main/ipc-handlers')

beforeEach(async () => {
  handlers.clear()
  vi.resetModules()
  vi.clearAllMocks()
  state.checkUpdatesOnStartup = true
  app.isPackaged = true
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

  it('returns a failure result instead of throwing when the check fails', async () => {
    checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    await expect(invoke('updater:check-on-startup')).resolves.toMatchObject({ success: false })
  })

  it.each([true, false])('skips the check in a dev build (pref %s)', async (pref) => {
    app.isPackaged = false
    state.checkUpdatesOnStartup = pref
    await expect(invoke('updater:check-on-startup')).resolves.toEqual({
      success: true,
      data: null
    })
    expect(checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('updater:check-now', () => {
  it('checks even when the startup pref is off', async () => {
    state.checkUpdatesOnStartup = false
    await expect(invoke('updater:check-now')).resolves.toEqual({ success: true, data: '9.9.9' })
    expect(checkForUpdates).toHaveBeenCalledOnce()
  })

  it('checks in a dev build', async () => {
    app.isPackaged = false
    await expect(invoke('updater:check-now')).resolves.toEqual({ success: true, data: '9.9.9' })
    expect(checkForUpdates).toHaveBeenCalledOnce()
  })

  it('returns a failure result instead of throwing when clearing the snooze fails', async () => {
    const { setPref } = await import('@main/prefs/prefs')
    vi.mocked(setPref).mockImplementationOnce(() => {
      throw new Error('EPERM')
    })
    await expect(invoke('updater:check-now')).resolves.toMatchObject({ success: false })
  })
})

// The version comes from the renderer; main must not trust its shape.
describe('updater:snooze and updater:dismiss', () => {
  it('snoozes a version through prefs', async () => {
    const { setPref } = await import('@main/prefs/prefs')
    await expect(invoke('updater:snooze', '9.9.9')).resolves.toEqual({ success: true, data: null })
    expect(setPref).toHaveBeenCalledWith(
      'updateSnooze',
      expect.objectContaining({ version: '9.9.9' })
    )
  })

  it.each([
    ['updater:snooze', ''],
    ['updater:snooze', 42],
    ['updater:snooze', undefined],
    ['updater:dismiss', ''],
    ['updater:dismiss', { version: '9.9.9' }]
  ])('%s rejects the version %j', async (channel, version) => {
    const { setPref } = await import('@main/prefs/prefs')
    await expect(invoke(channel, version)).resolves.toEqual({
      success: false,
      error: 'Invalid version'
    })
    expect(setPref).not.toHaveBeenCalled()
  })
})
