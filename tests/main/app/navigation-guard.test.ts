import { EventEmitter } from 'node:events'

import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: new EventEmitter(),
    shell: { openExternal: vi.fn(async () => undefined) }
  }
})

type WindowOpenHandler = Parameters<WebContents['setWindowOpenHandler']>[0]

class FakeWebContents extends EventEmitter {
  setWindowOpenHandler = vi.fn<(handler: WindowOpenHandler) => void>()
}

// Every webContents gets the guards, not only the main window's: one created later (a second
// window, a view, DevTools) must not start with navigation and window.open unrestricted.
describe('installNavigationGuard', () => {
  let app: EventEmitter
  let openExternal: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const electron = await import('electron')
    app = electron.app as unknown as EventEmitter
    app.removeAllListeners()
    openExternal = vi.mocked(electron.shell.openExternal)
    const { installNavigationGuard } = await import('@main/navigation-guard')
    installNavigationGuard()
  })

  function createContents(): FakeWebContents {
    const contents = new FakeWebContents()
    app.emit('web-contents-created', {}, contents)
    return contents
  }

  // The renderer is a SPA that never navigates and any loaded page gets window.notvex, so
  // every navigation is blocked, lookalike hosts and dropped files included.
  it.each([
    'file:///C:/Users/me/Downloads/evil.html',
    'http://localhost.attacker.example/',
    'http://localhost:5173/',
    'https://github.com/GFrancV/notvex'
  ])('blocks navigation to %s', (url) => {
    const contents = createContents()
    const event = { preventDefault: vi.fn() }

    contents.emit('will-navigate', event, url)

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('blocks attaching a <webview>', () => {
    const contents = createContents()
    const event = { preventDefault: vi.fn() }

    contents.emit('will-attach-webview', event, {}, {})

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('guards each webContents separately', () => {
    const first = createContents()
    const second = createContents()
    const event = { preventDefault: vi.fn() }

    second.emit('will-navigate', event, 'https://example.com')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(first.setWindowOpenHandler).toHaveBeenCalledOnce()
    expect(second.setWindowOpenHandler).toHaveBeenCalledOnce()
  })

  // target="_blank" links (note live preview, release notes) and window.open reach the OS
  // through the window-open handler, so it must apply the same scheme filter as
  // shell:open-external — file:, ms-msdt:, search-ms: etc. are the usual path from
  // "click a link" to code execution on Windows.
  function openWindow(url: string): unknown {
    const contents = createContents()
    const [handler] = contents.setWindowOpenHandler.mock.calls[0]!
    return handler({ url } as Parameters<WindowOpenHandler>[0])
  }

  it.each(['https://github.com/GFrancV/notvex', 'http://example.com', 'HTTPS://example.com'])(
    'opens %s in the system browser',
    (url) => {
      expect(openWindow(url)).toEqual({ action: 'deny' })
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
    }
  )

  it.each([
    'file://\\\\attacker\\share\\x.exe',
    'file:///C:/Windows/System32/calc.exe',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x',
    'javascript:alert(1)'
  ])('never hands %s to the OS', (url) => {
    expect(openWindow(url)).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
