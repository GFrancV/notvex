import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// The renderer is untrusted input to the log: whatever it sends is validated, cut down and
// rate-limited here, before the allowlist in error-log.ts ever sees it.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.4.0' },
  dialog: {},
  shell: { openPath: vi.fn(async () => '') },
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
vi.mock('@main/vault/vault', () => ({}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))
vi.mock('@main/error-log', () => ({
  appendError: vi.fn(),
  clearLog: vi.fn(),
  ensureLogDir: vi.fn(() => '/user-data/logs'),
  readLogTail: vi.fn(() => '2026-01-01T00:00:00.000Z [main] v1.4.0 TypeError')
}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { appendError, clearLog, ensureLogDir, readLogTail } = await import('@main/error-log')
const { shell } = await import('electron')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

registerIpcHandlers({} as Electron.BrowserWindow, () => null)
stopAutoLockTimer()

let clock = Date.UTC(2026, 0, 1)

beforeEach(() => {
  vi.clearAllMocks()
  // Each test starts outside the previous one's rate-limit window.
  clock += 120_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

describe('log:error', () => {
  it('logs a valid payload as a renderer error', async () => {
    const result = await invoke('log:error', { name: 'TypeError', stack: 'at f (x.js:1:1)' })

    expect(result).toEqual({ success: true, data: null })
    expect(appendError).toHaveBeenCalledExactlyOnceWith('renderer', {
      name: 'TypeError',
      stack: 'at f (x.js:1:1)'
    })
  })

  it.each([
    ['null', null],
    ['a string', 'TypeError'],
    ['an array', ['TypeError', '']],
    ['a non-string name', { name: 1, stack: '' }],
    ['a non-string stack', { name: 'Error', stack: { toString: (): string => '' } }],
    ['a missing stack', { name: 'Error' }]
  ])('rejects %s', async (_label, payload) => {
    const result = await invoke('log:error', payload)

    expect(result).toEqual({ success: false, error: 'Invalid error payload' })
    expect(appendError).not.toHaveBeenCalled()
  })

  it('cuts the stack to 4 KB before it is formatted', async () => {
    await invoke('log:error', { name: 'Error', stack: 'x'.repeat(10 * 1024) })

    const [, sent] = vi.mocked(appendError).mock.calls[0]
    expect((sent as { stack: string }).stack).toHaveLength(4 * 1024)
  })

  it('drops errors past 10 per minute without failing', async () => {
    const payload = { name: 'Error', stack: '' }
    for (let i = 0; i < 10; i++) await invoke('log:error', payload)

    const result = await invoke('log:error', payload)

    expect(result).toEqual({ success: true, data: null })
    expect(appendError).toHaveBeenCalledTimes(10)
  })

  it('accepts errors again once the minute has passed', async () => {
    const payload = { name: 'Error', stack: '' }
    for (let i = 0; i < 10; i++) await invoke('log:error', payload)

    clock += 60_000
    await invoke('log:error', payload)

    expect(appendError).toHaveBeenCalledTimes(11)
  })
})

describe('log:build-report', () => {
  it('returns the environment and the last 30 log lines', async () => {
    const result = (await invoke('log:build-report')) as {
      success: true
      data: { environment: string; log: string }
    }

    expect(result.success).toBe(true)
    expect(result.data.environment).toContain('1.4.0')
    expect(result.data.environment).toContain(process.versions.electron ?? 'unknown')
    expect(result.data.environment).toContain(process.platform)
    expect(result.data.log).toBe('2026-01-01T00:00:00.000Z [main] v1.4.0 TypeError')
    expect(readLogTail).toHaveBeenCalledWith(30)
  })

  it('fails cleanly when the log cannot be read', async () => {
    vi.mocked(readLogTail).mockImplementationOnce(() => {
      throw new Error('EACCES')
    })

    expect(await invoke('log:build-report')).toEqual({ success: false, error: 'EACCES' })
  })
})

describe('log:open-folder', () => {
  it('creates the folder first, so it opens even before any error was logged', async () => {
    expect(await invoke('log:open-folder')).toEqual({ success: true, data: null })
    expect(ensureLogDir).toHaveBeenCalledTimes(1)
    expect(shell.openPath).toHaveBeenCalledExactlyOnceWith('/user-data/logs')
  })

  it('fails with the error openPath reports', async () => {
    vi.mocked(shell.openPath).mockResolvedValueOnce('Failed to open path')
    expect(await invoke('log:open-folder')).toEqual({
      success: false,
      error: 'Failed to open path'
    })
  })
})

describe('log:clear', () => {
  it('clears the log', async () => {
    expect(await invoke('log:clear')).toEqual({ success: true, data: null })
    expect(clearLog).toHaveBeenCalledTimes(1)
  })

  it('fails cleanly when the files cannot be removed', async () => {
    vi.mocked(clearLog).mockImplementationOnce(() => {
      throw new Error('EBUSY')
    })
    expect(await invoke('log:clear')).toEqual({ success: false, error: 'EBUSY' })
  })
})
