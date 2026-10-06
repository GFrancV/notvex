import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '../src/main/url-guard'

// Any page the window ends up loading gets the preload's window.notvex, and a
// navigation keeps the same WebContents, so a sender-identity check can't tell
// the app's page from a foreign one. Every handler must check the calling
// frame's URL instead, and refuse before doing anything (#57).

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {},
  shell: { openExternal: vi.fn(async () => undefined) },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      handlers.set(channel, fn)
    }
  }
}))

vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('../src/main/prefs', () => ({ getPref: vi.fn(() => 0) }))
vi.mock('../src/main/vault/backups', () => ({}))
vi.mock('../src/main/vault/container', () => ({}))
vi.mock('../src/main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('../src/main/vault/vault', () => ({ isVaultOpen: vi.fn(() => false) }))
vi.mock('../src/main/db/queries', () => ({}))
vi.mock('../src/main/clipboard-guard', () => ({}))
vi.mock('../src/main/drain-renderer', () => ({}))

const APP_URL = pathToFileURL(rendererIndexPath).href

const REFUSED = { success: false, error: 'Untrusted sender' }

// A refused call returns synchronously and a served one is async, so always
// hand back a promise.
function invokeFromFrame(
  url: string | null,
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender: {}, senderFrame: url === null ? null : { url } }, ...args))
}

describe('ipc handlers: sender frame check (issue #57)', () => {
  let ipc: typeof import('../src/main/ipc-handlers')
  let openExternal: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    handlers.clear()
    vi.resetModules()
    vi.clearAllMocks()
    openExternal = vi.mocked((await import('electron')).shell.openExternal)
    ipc = await import('../src/main/ipc-handlers')
    ipc.registerIpcHandlers({ isDestroyed: () => false } as never, () => null)
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
    vi.unstubAllEnvs()
  })

  it.each([APP_URL, `${APP_URL}#/notes`, `${APP_URL}?x=1`])(
    'serves the app page (%s)',
    async (url) => {
      await expect(
        invokeFromFrame(url, 'shell:open-external', 'https://example.com')
      ).resolves.toEqual({ success: true, data: null })
      expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com')
    }
  )

  it.each([
    ['a dropped file', 'file:///C:/Users/me/Downloads/evil.html'],
    ['a sibling file', pathToFileURL(rendererIndexPath + '.evil.html').href],
    ['a remote page', 'https://attacker.example/'],
    ['a destroyed frame', null],
    ['an unparsable url', 'not a url']
  ])('refuses %s before running the handler', async (_label, url) => {
    await expect(
      invokeFromFrame(url, 'shell:open-external', 'https://example.com')
    ).resolves.toEqual(REFUSED)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('in dev, trusts only the dev server origin', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')

    await expect(
      invokeFromFrame('http://localhost.attacker.example:5173/', 'shell:open-external', 'https://x')
    ).resolves.toEqual(REFUSED)
    await expect(invokeFromFrame(APP_URL, 'shell:open-external', 'https://x')).resolves.toEqual(
      REFUSED
    )
    await expect(
      invokeFromFrame('http://localhost:5173/', 'shell:open-external', 'https://x')
    ).resolves.toEqual({ success: true, data: null })
    expect(openExternal).toHaveBeenCalledOnce()
  })

  it('in a packaged build, ignores ELECTRON_RENDERER_URL', async () => {
    const app = (await import('electron')).app as unknown as { isPackaged: boolean }
    app.isPackaged = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'https://attacker.example')

    try {
      await expect(
        invokeFromFrame('https://attacker.example/', 'shell:open-external', 'https://x')
      ).resolves.toEqual(REFUSED)
      await expect(invokeFromFrame(APP_URL, 'shell:open-external', 'https://x')).resolves.toEqual({
        success: true,
        data: null
      })
    } finally {
      app.isPackaged = false
    }
  })

  // Even the app's own page only gets http(s) handed to the OS: shell:open-external
  // shares isSafeExternalUrl with the window-open handler (#56).
  it.each(['file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id PCWDiagnostic', 'javascript:x'])(
    'shell:open-external refuses %s from the app page',
    async (url) => {
      const result = await invokeFromFrame(APP_URL, 'shell:open-external', url)

      expect(result).toMatchObject({ success: false })
      expect(openExternal).not.toHaveBeenCalled()
    }
  )

  // Behavioural guard against a new channel registered without the check.
  it('every registered channel refuses a foreign frame', async () => {
    expect(handlers.size).toBeGreaterThan(40)
    for (const channel of handlers.keys()) {
      await expect(invokeFromFrame('file:///tmp/evil.html', channel), channel).resolves.toEqual(
        REFUSED
      )
    }
  })
})
