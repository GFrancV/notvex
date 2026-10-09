import { EventEmitter } from 'events'

import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal EventEmitter stand-in for `app`. whenReady() never resolves by default, so the
// shutdown tests never start the app; the no-window block resolves it per test. events is
// imported dynamically because vi.mock is hoisted above top-level imports.
vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  class MockApp extends EventEmitter {
    isPackaged = true
    quit = vi.fn()
    setName = vi.fn()
    enableSandbox = vi.fn()
    requestSingleInstanceLock = vi.fn(() => true)
    commandLine = { hasSwitch: vi.fn<(name: string) => boolean>(() => false) }
    whenReady = vi.fn(() => new Promise<void>(() => {}))
  }
  return {
    app: new MockApp()
  }
})

vi.mock('@main/vault/vault', () => ({
  closeVault: vi.fn().mockResolvedValue({ packFailed: false }),
  getVaultPath: vi.fn(() => null),
  isVaultOpen: vi.fn(() => false)
}))

// closeVaultDrained() forwards to the mocked closeVault() so the assertions
// below keep counting real close attempts; draining itself is covered by
// tests/main/app/drain-renderer.test.ts.
vi.mock('@main/ipc-handlers', async () => {
  const { closeVault } = await import('@main/vault/vault')
  return {
    stopAutoLockTimer: vi.fn(),
    closeVaultDrained: vi.fn(() => closeVault())
  }
})

vi.mock('@main/window', () => ({
  createWindow: vi.fn()
}))

// Startup side effects: the real cleanupOrphanedTempDbs() deletes files in
// os.tmpdir(), so neither may run once whenReady() resolves (the no-window block below).
vi.mock('@main/vault/crypto', () => ({
  initSodium: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@main/vault/container', () => ({
  cleanupOrphanedTempDbs: vi.fn()
}))

vi.mock('@main/file-opener', () => ({
  extractNvxArgv: vi.fn((argv: string[]) => argv.find((a) => a.endsWith('.nvx')) ?? null),
  resolveOpenFilePath: vi.fn().mockResolvedValue(undefined),
  setValidatedPending: vi.fn(),
  takePendingOpenFilePath: vi.fn(() => null)
}))

// A BrowserWindow double that, like the real one, throws once destroyed.
class FakeWindow extends EventEmitter {
  destroyed = false
  isMinimized = vi.fn(() => {
    this.assertAlive()
    return false
  })
  restore = vi.fn(() => this.assertAlive())
  focus = vi.fn(() => this.assertAlive())

  close(): void {
    this.destroyed = true
    this.emit('closed')
  }

  private assertAlive(): void {
    if (this.destroyed) throw new TypeError('Object has been destroyed')
  }
}

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
    // The 'electron' mock module (unlike '@main/index') survives
    // vi.resetModules(), so its listeners must be cleared by hand before
    // each fresh import of index.ts re-registers its handlers.
    app.removeAllListeners()
    const vaultMock = await import('@main/vault/vault')
    closeVault = vi.mocked(vaultMock.closeVault)
    await import('@main/index')
  })

  afterEach(() => {
    setPlatform(originalPlatform)
    vi.restoreAllMocks()
  })

  it('sandboxes every renderer before the app is ready', () => {
    expect(app.enableSandbox).toHaveBeenCalledTimes(1)
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

  it('a duplicate before-quit signal while closeVault() is still in flight is still prevented', async () => {
    let resolveClose: () => void = () => {}
    closeVault.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve
        })
    )

    const firstEvent = { preventDefault: vi.fn() }
    app.emit('before-quit', firstEvent)

    // A second external quit (e.g. a repeated Cmd+Q) before the first close settles, not the
    // re-entrant app.quit() from the finally.
    const secondEvent = { preventDefault: vi.fn() }
    app.emit('before-quit', secondEvent)

    expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(closeVault).toHaveBeenCalledTimes(1) // still guarded: no second closeVault() call

    resolveClose()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
  })

  it('if closeVault() rejects, it logs the error without its path and still calls app.quit() in the finally', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const vaultPath = '/home/alice/Private Notes/diary.nvx'
    closeVault.mockRejectedValueOnce(
      Object.assign(new Error(`EACCES: permission denied, open '${vaultPath}'`), {
        code: 'EACCES',
        path: vaultPath
      })
    )

    app.emit('before-quit', { preventDefault: vi.fn() })

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      expect(quit).toHaveBeenCalledTimes(1)
    })
    for (const arg of consoleErrorSpy.mock.calls[0]) expect(String(arg)).not.toContain(vaultPath)
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

describe('lifecycle: .nvx opened while the app has no window (issue #49)', () => {
  const NVX = '/Users/me/vault.nvx'
  let app: Electron.App
  let createWindow: ReturnType<typeof vi.fn>
  let fileOpener: typeof import('@main/file-opener')
  let windows: FakeWindow[]

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    app = (await import('electron')).app
    app.removeAllListeners()
    windows = []
    createWindow = vi.mocked((await import('@main/window')).createWindow)
    createWindow.mockImplementation(() => {
      const win = new FakeWindow()
      windows.push(win)
      return win as unknown as BrowserWindow
    })
    fileOpener = await import('@main/file-opener')
    // Once, so the shutdown block above keeps its never-resolving whenReady().
    vi.mocked(app.whenReady).mockResolvedValueOnce(undefined)
  })

  async function startApp(): Promise<void> {
    await import('@main/index')
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledTimes(1))
  }

  it('open-file after the window closed stores the path and opens a new window', async () => {
    await startApp()
    windows[0].close()

    app.emit('open-file', { preventDefault: vi.fn() }, NVX)

    expect(fileOpener.resolveOpenFilePath).not.toHaveBeenCalled()
    expect(fileOpener.setValidatedPending).toHaveBeenCalledWith(NVX)
    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(createWindow).toHaveBeenLastCalledWith(fileOpener.takePendingOpenFilePath)
  })

  it('open-file during startup only stores the path, and startup opens exactly one window', async () => {
    let finishSodium: () => void = () => {}
    const { initSodium } = await import('@main/vault/crypto')
    vi.mocked(initSodium).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSodium = resolve
      })
    )
    await import('@main/index')
    await vi.waitFor(() => expect(initSodium).toHaveBeenCalled())

    app.emit('open-file', { preventDefault: vi.fn() }, NVX)
    expect(fileOpener.setValidatedPending).toHaveBeenCalledWith(NVX)
    expect(createWindow).not.toHaveBeenCalled()

    finishSodium()
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledTimes(1))
    expect(createWindow).toHaveBeenCalledWith(fileOpener.takePendingOpenFilePath)
    expect(fileOpener.resolveOpenFilePath).not.toHaveBeenCalled()
  })

  it('open-file with a live window hands the file to it without opening another', async () => {
    await startApp()

    app.emit('open-file', { preventDefault: vi.fn() }, NVX)

    expect(fileOpener.resolveOpenFilePath).toHaveBeenCalledWith(windows[0], NVX)
    expect(createWindow).toHaveBeenCalledTimes(1)
  })

  it("a stale 'closed' from an old window does not drop the current one", async () => {
    await startApp()
    windows[0].close()
    app.emit('open-file', { preventDefault: vi.fn() }, NVX)
    windows[0].emit('closed')

    app.emit('open-file', { preventDefault: vi.fn() }, NVX)

    expect(fileOpener.resolveOpenFilePath).toHaveBeenCalledWith(windows[1], NVX)
    expect(createWindow).toHaveBeenCalledTimes(2)
  })

  it('second-instance after the window closed stores the .nvx and opens a new window', async () => {
    await startApp()
    windows[0].close()

    // Would throw 'Object has been destroyed' if the dead window were touched.
    app.emit('second-instance', {}, ['notvex', NVX])

    expect(fileOpener.resolveOpenFilePath).not.toHaveBeenCalled()
    expect(fileOpener.setValidatedPending).toHaveBeenCalledWith(NVX)
    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(createWindow).toHaveBeenLastCalledWith(fileOpener.takePendingOpenFilePath)
  })

  it('second-instance after the window closed opens a window even without a .nvx', async () => {
    await startApp()
    windows[0].close()

    app.emit('second-instance', {}, ['notvex'])

    expect(fileOpener.setValidatedPending).not.toHaveBeenCalled()
    expect(createWindow).toHaveBeenCalledTimes(2)
  })

  it('open-file / second-instance while quitting do not open a window', async () => {
    await startApp()
    // Cmd+Q: before-quit is already in flight when the window closes.
    app.emit('before-quit', { preventDefault: vi.fn() })
    windows[0].close()

    app.emit('open-file', { preventDefault: vi.fn() }, NVX)
    app.emit('second-instance', {}, ['notvex', NVX])

    expect(createWindow).toHaveBeenCalledTimes(1)
  })

  it('second-instance with a live window focuses it and hands it the .nvx', async () => {
    await startApp()

    app.emit('second-instance', {}, ['notvex', NVX])

    expect(windows[0].focus).toHaveBeenCalled()
    expect(fileOpener.resolveOpenFilePath).toHaveBeenCalledWith(windows[0], NVX)
    expect(createWindow).toHaveBeenCalledTimes(1)
  })
})

describe('lifecycle: Chromium switches that bypass the renderer boundary', () => {
  let app: Electron.App
  let exit: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    app = (await import('electron')).app
    app.removeAllListeners()
    exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    Object.assign(app, { isPackaged: true })
    vi.mocked(app.commandLine.hasSwitch).mockImplementation(() => false)
    vi.restoreAllMocks()
  })

  function launchWith(switchName: string, isPackaged: boolean): Promise<unknown> {
    Object.assign(app, { isPackaged })
    vi.mocked(app.commandLine.hasSwitch).mockImplementation((name) => name === switchName)
    return import('@main/index')
  }

  it.each([
    'remote-debugging-port',
    'remote-debugging-pipe',
    'renderer-cmd-prefix',
    'gpu-launcher',
    'utility-cmd-prefix',
    'browser-subprocess-path',
    'no-sandbox'
  ])(
    'a packaged build launched with --%s exits before taking the single-instance lock',
    async (switchName) => {
      await launchWith(switchName, true)

      expect(exit).toHaveBeenCalledWith(1)
      expect(exit.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(app.requestSingleInstanceLock).mock.invocationCallOrder[0]
      )
    }
  )

  it('a dev build keeps --remote-debugging-port available', async () => {
    await launchWith('remote-debugging-port', false)

    expect(exit).not.toHaveBeenCalled()
  })

  it('a packaged build launched without the switches starts normally', async () => {
    await launchWith('', true)

    expect(exit).not.toHaveBeenCalled()
  })
})
