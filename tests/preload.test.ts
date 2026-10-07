import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { NotvexAPI } from '@shared/types'

// The main process sends 'vault:pack-failed' (asserted in close-paths.test.ts);
// a typo on this side would leave the toast silently dead (#61).

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
    await import('../src/preload/index')
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
