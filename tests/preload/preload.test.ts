import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { NotvexAPI } from '@shared/types'

// The main process sends 'vault:pack-failed' (asserted in tests/main/ipc/close-paths.test.ts);
// a typo on this side would leave the toast silently dead.

const on = vi.fn()
const off = vi.fn()
let api: NotvexAPI

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, value: NotvexAPI): void => {
      api = value
    }
  },
  ipcRenderer: { on, off, invoke: vi.fn(), send: vi.fn() }
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
