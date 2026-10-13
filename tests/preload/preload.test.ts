import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { NotvexAPI } from '@shared/types'

// The main process sends 'vault:pack-failed' (asserted in tests/main/ipc/close-paths.test.ts);
// a typo on this side would leave the toast silently dead.

const on = vi.fn()
const off = vi.fn()
const invoke = vi.fn()
let api: NotvexAPI

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, value: NotvexAPI): void => {
      api = value
    }
  },
  ipcRenderer: { on, off, invoke, send: vi.fn() }
}))

describe('preload: onPackFailed (issue #61)', () => {
  beforeAll(async () => {
    await import('../../src/preload/index')
  })

  it('calls back when the main process sends vault:pack-failed', () => {
    const callback = vi.fn()

    api.onPackFailed(callback)
    const [channel, listener] = on.mock.calls.at(-1) as [string, () => void]
    listener()

    expect(channel).toBe('vault:pack-failed')
    expect(callback).toHaveBeenCalledOnce()
  })

  it('unsubscribes the same listener it registered', () => {
    const unsubscribe = api.onPackFailed(vi.fn())
    const [, listener] = on.mock.calls.at(-1) as [string, () => void]

    unsubscribe()

    expect(off).toHaveBeenCalledWith('vault:pack-failed', listener)
  })
})

// The app menu sends 'app:reload-requested' (asserted in tests/main/app/app-menu.test.ts).
describe('preload: onReloadRequested', () => {
  beforeAll(async () => {
    await import('../../src/preload/index')
  })

  it('calls back when the main process sends app:reload-requested', () => {
    const callback = vi.fn()

    api.onReloadRequested(callback)
    const [channel, listener] = on.mock.calls.at(-1) as [string, () => void]
    listener()

    expect(channel).toBe('app:reload-requested')
    expect(callback).toHaveBeenCalledOnce()
  })

  it('unsubscribes the same listener it registered', () => {
    const unsubscribe = api.onReloadRequested(vi.fn())
    const [, listener] = on.mock.calls.at(-1) as [string, () => void]

    unsubscribe()

    expect(off).toHaveBeenCalledWith('app:reload-requested', listener)
  })
})

// Main only enforces the startup opt-out on this channel; routing checkOnStartup to
// updater:check-now would bypass it.
describe('preload: updater.checkOnStartup', () => {
  beforeAll(async () => {
    await import('../../src/preload/index')
  })

  it('invokes the gated startup channel', () => {
    void api.updater.checkOnStartup()

    expect(invoke).toHaveBeenLastCalledWith('updater:check-on-startup')
  })
})

// Channel names are plain strings on both sides: a typo types fine and only fails at runtime.
// The handlers are asserted in tests/main/ipc/markdown-io-handlers.test.ts.
describe('preload: Markdown export/import channels', () => {
  beforeAll(async () => {
    await import('../../src/preload/index')
  })

  it('sends notes.export to notes:export with the note id', () => {
    void api.notes.export('n1')

    expect(invoke).toHaveBeenLastCalledWith('notes:export', 'n1')
  })

  it('sends notes.exportAll to notes:export-all', () => {
    void api.notes.exportAll()

    expect(invoke).toHaveBeenLastCalledWith('notes:export-all')
  })

  it('sends notes.import to notes:import', () => {
    void api.notes.import()

    expect(invoke).toHaveBeenLastCalledWith('notes:import')
  })
})
