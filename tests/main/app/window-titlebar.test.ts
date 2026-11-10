import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

// Each platform draws its own window controls over the hidden title bar: an overlay on Windows
// and Linux, the traffic lights on macOS. window.ts reads process.platform when it loads, so
// every case re-imports it under the platform it fakes.

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class MockBrowserWindow extends EventEmitter {
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) {
      super()
    }
    webContents = Object.assign(new EventEmitter(), { openDevTools: vi.fn(), reload: vi.fn() })
    loadURL = vi.fn(async () => undefined)
    loadFile = vi.fn(async () => undefined)
    setTitle = vi.fn()
    setMenuBarVisibility = vi.fn()
    setContentProtection = vi.fn()
    isDestroyed = vi.fn(() => false)
    close = vi.fn()
  }
  return {
    app: { isPackaged: true },
    BrowserWindow: MockBrowserWindow,
    powerMonitor: new EventEmitter()
  }
})

vi.mock('@main/ipc-handlers', () => ({
  cancelPendingConfirmations: vi.fn(),
  closeVaultDrained: vi.fn(async () => undefined),
  isRecoveryConfirmPending: vi.fn(() => false),
  lockVaultAndNotify: vi.fn(async () => undefined),
  markRendererReplaced: vi.fn(),
  registerIpcHandlers: vi.fn()
}))
vi.mock('@main/error-log', () => ({ appendError: vi.fn() }))
vi.mock('@main/prefs', () => ({ getPref: vi.fn(() => false) }))
vi.mock('@main/updater', () => ({ initAutoUpdater: vi.fn() }))
vi.mock('@main/vault/vault', () => ({ isVaultOpen: vi.fn(() => false) }))

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

async function windowOptionsOn(
  platform: NodeJS.Platform
): Promise<Electron.BrowserWindowConstructorOptions> {
  Object.defineProperty(process, 'platform', { value: platform })
  vi.resetModules()
  const { createWindow } = await import('@main/window')
  const win = createWindow(() => null) as unknown as {
    options: Electron.BrowserWindowConstructorOptions
  }
  return win.options
}

const OVERLAY = { color: '#0a0a0a', symbolColor: '#a3a3a3', height: 40 }

describe('createWindow: window controls', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
  })

  it.each(['win32', 'linux'] as const)('draws the controls overlay on %s', async (platform) => {
    const options = await windowOptionsOn(platform)

    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toEqual(OVERLAY)
    expect(options.trafficLightPosition).toBeUndefined()
  })

  it('keeps the traffic lights and no overlay on macOS', async () => {
    const options = await windowOptionsOn('darwin')

    expect(options.titleBarStyle).toBe('hidden')
    expect(options.trafficLightPosition).toEqual({ x: 14, y: 13 })
    expect(options.titleBarOverlay).toBeUndefined()
  })
})

describe('title bar drag strip: draggable from the first frame', () => {
  const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

  it('declares a 44px drag strip in index.html ahead of the React root', () => {
    const html = read('src/renderer/index.html')
    const rule = html.match(/#boot-drag\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(rule).toMatch(/-webkit-app-region:\s*drag/)
    expect(rule).toMatch(/height:\s*44px/)
    expect(html.indexOf('id="boot-drag"')).toBeGreaterThan(-1)
    expect(html.indexOf('id="boot-drag"')).toBeLessThan(html.indexOf('id="root"'))
  })

  it('leaves no view or component rendering its own titlebar-drag strip', () => {
    const src = resolve(process.cwd(), 'src/renderer/src')
    const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.tsx'))
      .filter((file) => readFileSync(resolve(src, file), 'utf8').includes('titlebar-drag'))

    expect(offenders).toEqual([])
  })

  it('keeps only the no-drag rules in main.css', () => {
    const css = read('src/renderer/src/assets/main.css')

    expect(css).not.toContain('.titlebar-drag')
    expect(css).toMatch(/\.titlebar-no-drag\s*\{[^}]*-webkit-app-region:\s*no-drag/)
    expect(css).toMatch(/data-slot='dialog-content'\][^{]*\{[^}]*-webkit-app-region:\s*no-drag/)
  })

  it('lets the whole strip drag while a dialog or sheet is open', () => {
    const css = read('src/renderer/src/assets/main.css')
    const [, selector = '', body = ''] =
      css.match(/([^{}]*:has\([^{}]*\)[^{}]*\.titlebar-no-drag)\s*\{([^}]*)\}/) ?? []

    expect(selector).toContain("data-slot='dialog-overlay'")
    expect(selector).toContain("data-slot='sheet-overlay'")
    expect(body).toMatch(/-webkit-app-region:\s*drag/)
  })
})
