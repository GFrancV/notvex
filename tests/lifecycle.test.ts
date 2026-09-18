import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron's real `app` isn't available outside a running Electron process,
// so it's replaced with a minimal EventEmitter double: `index.ts` only
// needs `on`/`emit`/`quit`/`whenReady`/`requestSingleInstanceLock`/`isPackaged`.
// `whenReady()` never resolves — the startup path (window creation, sodium
// init) is out of scope for this suite, which only covers the shutdown
// handlers (issue #18). The dynamic `import('events')` (instead of a
// top-level import) avoids vi.mock's hoisting running before that binding
// is initialized.
vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  class MockApp extends EventEmitter {
    isPackaged = true
    quit = vi.fn()
    setName = vi.fn()
    requestSingleInstanceLock = vi.fn(() => true)
    whenReady = vi.fn(() => new Promise<void>(() => {}))
  }
  return {
    app: new MockApp()
  }
})

vi.mock('../src/main/vault/vault', () => ({
  closeVault: vi.fn().mockResolvedValue(undefined),
  getVaultPath: vi.fn(() => null),
  isVaultOpen: vi.fn(() => false)
}))

vi.mock('../src/main/ipc-handlers', () => ({
  stopAutoLockTimer: vi.fn()
}))

vi.mock('../src/main/window', () => ({
  createWindow: vi.fn()
}))

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('lifecycle: before-quit / window-all-closed (issue #18)', () => {
  let app: Electron.App
  let closeVault: ReturnType<typeof vi.fn>
  let quit: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const electronMock = await import('electron')
    app = electronMock.app
    quit = vi.mocked(app.quit)
    // The 'electron' mock module (unlike '../src/main/index') survives
    // vi.resetModules(), so its listeners must be cleared by hand before
    // each fresh import of index.ts re-registers its handlers.
    app.removeAllListeners()
    const vaultMock = await import('../src/main/vault/vault')
    closeVault = vi.mocked(vaultMock.closeVault)
    await import('../src/main/index')
  })

  afterEach(() => {
    setPlatform(originalPlatform)
    vi.restoreAllMocks()
  })

  it('before-quit calls event.preventDefault() synchronously', () => {
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('firing before-quit twice invokes closeVault() only once', async () => {
    app.emit('before-quit', { preventDefault: vi.fn() })
    app.emit('before-quit', { preventDefault: vi.fn() })
    await vi.waitFor(() => expect(closeVault).toHaveBeenCalledTimes(1))
  })

  it('if closeVault() rejects, it logs the error and still calls app.quit() in the finally', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    closeVault.mockRejectedValueOnce(new Error('boom'))

    app.emit('before-quit', { preventDefault: vi.fn() })

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      expect(quit).toHaveBeenCalledTimes(1)
    })
  })

  it('window-all-closed on Windows/Linux does not call closeVault(), only app.quit()', () => {
    setPlatform('win32')
    app.emit('window-all-closed')
    expect(closeVault).not.toHaveBeenCalled()
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('window-all-closed on macOS calls closeVault() and does not call app.quit()', () => {
    setPlatform('darwin')
    app.emit('window-all-closed')
    expect(closeVault).toHaveBeenCalledTimes(1)
    expect(quit).not.toHaveBeenCalled()
  })
})
