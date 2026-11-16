import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// prefs.json is hand-editable, so a network-share path in it must never reach the file system,
// while recent vaults whose file can't be used are kept for the user to see. The real prefs module
// is used so the recents filter and the handler's fs calls are tested together.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const fsState = vi.hoisted(() => ({ contents: '' }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/user-data' },
  dialog: {},
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => fsState.contents),
  existsSync: vi.fn(() => true),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn()
}))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { existsSync, writeFileSync } = await import('fs')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

const UNC = '\\\\host\\share\\v.nvx'
const local = { path: '/vaults/a.nvx', hasKeyFile: false, lastOpenedAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  registerIpcHandlers({} as BrowserWindow, () => null)
})

afterEach(() => stopAutoLockTimer())

describe('prefs:get', () => {
  it('never checks a network-share recent vault on disk', async () => {
    fsState.contents = JSON.stringify({ recentVaults: [{ ...local, path: UNC }, local] })

    expect(await invoke('prefs:get')).toMatchObject({
      success: true,
      data: { recentVaults: [local] }
    })
    expect(existsSync).not.toHaveBeenCalledWith(UNC)
  })

  it('keeps recent vaults whose file is missing, without rewriting prefs.json', async () => {
    const missing = { ...local, path: '/vaults/missing.nvx' }
    fsState.contents = JSON.stringify({ recentVaults: [missing, local] })
    vi.mocked(existsSync).mockImplementation((p) => p !== missing.path)

    expect(await invoke('prefs:get')).toMatchObject({
      success: true,
      data: { recentVaults: [missing, local] }
    })
    expect(writeFileSync).not.toHaveBeenCalled()
  })
})
