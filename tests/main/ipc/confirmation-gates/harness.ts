import type { BrowserWindow, WebContents } from 'electron'
import { pathToFileURL } from 'node:url'
import { vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// The gates in ipc-handlers.ts park vault:open on a module-level resolver until the renderer
// answers; these cover the cancel paths that unwedge it. Only what vault:open touches up to the
// gates is mocked.

type Handler = (event: unknown, ...args: unknown[]) => unknown

export const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {},
  shell: {},
  ipcMain: {
    // Same contract as Electron's: a second handler for a channel throws.
    handle: (channel: string, fn: Handler): void => {
      if (handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      handlers.set(channel, fn)
    }
  }
}))

vi.mock('electron-updater', () => ({ autoUpdater: {} }))

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => Buffer.alloc(0)),
  existsSync: vi.fn(() => false),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))

vi.mock('@main/prefs', () => ({
  getPref: vi.fn(() => 0),
  recordVaultUsed: vi.fn()
}))

vi.mock('@main/vault/backups', () => ({
  createVaultBackup: vi.fn(),
  ensureVaultBackupDir: vi.fn()
}))

vi.mock('@main/vault/container', () => ({
  readContainer: vi.fn(() => ({ versionMin: 0, devBuild: false })),
  shouldWarnOpeningInDevBuild: vi.fn(() => false)
}))

vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))

// Mirrors runMigrations: a declined schema gate surfaces as SCHEMA_MIGRATION_CANCELLED.
vi.mock('@main/vault/vault', () => ({
  getVaultPath: vi.fn(() => null),
  withVaultLock: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  isVaultOpen: vi.fn(() => false),
  closeVault: vi.fn(async () => ({ packFailed: false })),
  openVaultWithRecovery: vi.fn(async () => 1),
  syncContainer: vi.fn(),
  openVault: vi.fn(
    async (
      _path: string,
      _password: string,
      _kf: unknown,
      _bytes: unknown,
      gate?: (req: { fromVersion: number; toVersion: number }) => Promise<boolean>
    ) => {
      if (gate && !(await gate({ fromVersion: 1, toVersion: 2 }))) {
        throw new Error('SCHEMA_MIGRATION_CANCELLED')
      }
      return 1
    }
  )
}))

vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({ drainRenderer: vi.fn(async () => undefined) }))

// The renderer a handler call comes from by default: the most recently created
// window, i.e. the one the user is looking at.
let lastSender: WebContents | null = null

// Like a real BrowserWindow, sending to a destroyed one throws.
export function fakeWindow(): { win: BrowserWindow; sent: string[]; destroy: () => void } {
  const sent: string[] = []
  let destroyed = false
  const win = {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      send: (channel: string) => {
        if (destroyed) throw new Error('Object has been destroyed')
        sent.push(channel)
      }
    }
  } as unknown as BrowserWindow
  lastSender = win.webContents
  return { win, sent, destroy: () => (destroyed = true) }
}

// The app's own page, which every handler requires as the calling frame.
const senderFrame = { url: pathToFileURL(rendererIndexPath).href }

// Calls a handler the way ipcMain does: with an event carrying the calling renderer.
export function invokeFrom(
  sender: WebContents,
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender, senderFrame }, ...args))
}

export function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (!lastSender) throw new Error('no window created yet')
  return invokeFrom(lastSender, channel, ...args)
}

// Lets the handler run up to the point where it parks on a gate.
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

type Modules = {
  ipc: typeof import('@main/ipc-handlers')
  container: typeof import('@main/vault/container')
  vault: typeof import('@main/vault/vault')
  prefs: typeof import('@main/prefs')
}

// A fresh ipc-handlers module, with no window registered and the mocks back to their defaults.
export async function loadIpcModules(): Promise<Modules> {
  handlers.clear()
  vi.resetModules()
  vi.clearAllMocks()
  const container = await import('@main/vault/container')
  vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(false)
  const vault = await import('@main/vault/vault')
  vi.mocked(vault.isVaultOpen).mockReturnValue(false)
  vi.mocked(vault.closeVault).mockClear()
  const prefs = await import('@main/prefs')
  vi.mocked(prefs.getPref).mockReturnValue(0)
  const ipc = await import('@main/ipc-handlers')
  return { ipc, container, vault, prefs }
}
