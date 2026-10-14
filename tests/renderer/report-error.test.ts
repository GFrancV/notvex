// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// reportError runs from window.onerror and the ErrorBoundary, so it must never throw itself.

const ipc = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('@/lib/ipc', () => ({ notvex: { log: { error: ipc.error } } }))

const { reportError } = await import('@/lib/report-error')

beforeEach(() => {
  ipc.error.mockReset().mockResolvedValue({ success: true, data: null })
})

describe('reportError', () => {
  it('sends the error name and its stack frames, never the message', () => {
    const err = new RangeError('secret note text\n    at looks like a frame (x)')
    err.stack = `RangeError: ${err.message}\n    at f (app.js:1:1)`

    reportError(err)

    expect(ipc.error).toHaveBeenCalledExactlyOnceWith({
      name: 'RangeError',
      stack: '\n    at f (app.js:1:1)'
    })
  })

  it('sends a non-Error as NonError without stringifying it', () => {
    const toString = vi.fn(() => 'secret')
    reportError({ toString })
    expect(ipc.error).toHaveBeenCalledExactlyOnceWith({ name: 'NonError', stack: '' })
    expect(toString).not.toHaveBeenCalled()
  })

  it('swallows a rejected IPC call', async () => {
    ipc.error.mockRejectedValue(new Error('gone'))
    expect(() => reportError(new Error('x'))).not.toThrow()
    await Promise.resolve()
  })

  it('swallows an error whose getters throw', () => {
    const hostile = new Proxy(new Error('x'), {
      get: (): never => {
        throw new Error('boom')
      }
    })
    expect(() => reportError(hostile)).not.toThrow()
  })
})
