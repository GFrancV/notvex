import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// prefs:get checks every recent vault on disk at startup, and prefs.json is hand-editable, so a
// network-share path in it must never reach the file system. The real prefs module is used so
// the recents filter and the handler's fs calls are tested together.

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
vi.mock('@main/vault/container', () => ({ isValidNotvexFile: vi.fn(() => true) }))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { existsSync } = await import('fs')
const { isValidNotvexFile } = await import('@main/vault/container')

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
    expect(isValidNotvexFile).not.toHaveBeenCalledWith(UNC)
    expect(isValidNotvexFile).toHaveBeenCalledWith(local.path)
  })
})
