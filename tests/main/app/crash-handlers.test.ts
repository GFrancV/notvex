import { EventEmitter } from 'events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The handlers are captured through a process.on spy rather than registered for real: a live
// uncaughtException listener would swallow the test worker's own failures.

const calls = vi.hoisted(() => [] as string[])

vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  const app = Object.assign(new EventEmitter(), {
    exit: vi.fn(() => calls.push('exit'))
  })
  return { app }
})

vi.mock('@main/vault/vault', () => ({
  closeVault: vi.fn(() => {
    calls.push('closeVault')
    return Promise.resolve({ packFailed: false })
  })
}))

vi.mock('@main/clipboard-guard', () => ({
  clearClipboardIfOurs: vi.fn(() => {
    calls.push('clearClipboardIfOurs')
    return Promise.resolve()
  })
}))

vi.mock('@main/error-log', async (importOriginal) => {
  const real = await importOriginal<typeof import('@main/error-log')>()
  return {
    toErrorLike: real.toErrorLike,
    appendError: vi.fn(() => calls.push('appendError'))
  }
})

type Listener = (value: unknown) => void

let processListeners: Record<string, Listener>

async function install(): Promise<{
  app: EventEmitter & { exit: ReturnType<typeof vi.fn> }
  appendError: ReturnType<typeof vi.fn>
  closeVault: ReturnType<typeof vi.fn>
}> {
  vi.resetModules()
  processListeners = {}
  vi.spyOn(process, 'on').mockImplementation(((event: string, fn: Listener) => {
    processListeners[event] = fn
    return process
  }) as typeof process.on)
  const { installCrashHandlers } = await import('@main/crash-handlers')
  installCrashHandlers()
  const { app } = await import('electron')
  const { appendError } = await import('@main/error-log')
  const { closeVault } = await import('@main/vault/vault')
  return {
    app: app as unknown as EventEmitter & { exit: ReturnType<typeof vi.fn> },
    appendError: vi.mocked(appendError),
    closeVault: vi.mocked(closeVault)
  }
}

beforeEach(async () => {
  calls.length = 0
  vi.clearAllMocks()
  const { app } = await import('electron')
  app.removeAllListeners()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe.each(['uncaughtException', 'unhandledRejection'])('%s', (event) => {
  it('logs, then closes the vault and clears the clipboard, then exits with code 1', async () => {
    const { app, appendError } = await install()

    processListeners[event](new TypeError('secret'))
    await vi.runAllTimersAsync()

    expect(calls).toEqual(['appendError', 'closeVault', 'clearClipboardIfOurs', 'exit'])
    // The process is going away, so the recovery key's 30 s clear won't run.
    const { clearClipboardIfOurs } = await import('@main/clipboard-guard')
    expect(clearClipboardIfOurs).toHaveBeenCalledWith('quit')
    expect(appendError).toHaveBeenCalledWith('main', expect.objectContaining({ name: 'TypeError' }))
    expect(app.exit).toHaveBeenCalledWith(1)
  })
})

it('logs a non-Error rejection as NonError', async () => {
  const { appendError } = await install()

  processListeners['unhandledRejection']({ secret: 'value' })
  await vi.runAllTimersAsync()

  expect(appendError).toHaveBeenCalledWith('main', { name: 'NonError', stack: '' })
})

it('still exits after 3 s when closing the vault never settles', async () => {
  const { app, closeVault } = await install()
  closeVault.mockImplementationOnce(() => new Promise(() => {}))

  processListeners['uncaughtException'](new Error('x'))
  await vi.advanceTimersByTimeAsync(2_999)
  expect(app.exit).not.toHaveBeenCalled()

  await vi.advanceTimersByTimeAsync(1)
  expect(app.exit).toHaveBeenCalledWith(1)
  // A crash while the vault lock is held must not keep the clipboard from being cleared.
  expect(calls).toContain('clearClipboardIfOurs')
})

it('still clears the clipboard and exits when closing the vault rejects', async () => {
  const { app, appendError, closeVault } = await install()
  closeVault.mockRejectedValueOnce(new Error('pack failed'))

  processListeners['uncaughtException'](new Error('x'))
  await vi.runAllTimersAsync()

  expect(calls).toEqual(['appendError', 'clearClipboardIfOurs', 'exit'])
  expect(app.exit).toHaveBeenCalledWith(1)
  // The rejection must not escape as a second crash.
  expect(appendError).toHaveBeenCalledOnce()
})

it('exits immediately on an error raised while already handling one', async () => {
  const { app, closeVault } = await install()
  closeVault.mockImplementationOnce(() => new Promise(() => {}))

  processListeners['uncaughtException'](new Error('first'))
  processListeners['uncaughtException'](new Error('second'))

  expect(app.exit).toHaveBeenCalledTimes(1)
  expect(closeVault).toHaveBeenCalledTimes(1)
})

it('logs a gone child process without exiting', async () => {
  const { app, appendError } = await install()

  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 5 })

  expect(appendError).toHaveBeenCalledWith('gpu', { reason: 'crashed', exitCode: 5 })
  expect(app.exit).not.toHaveBeenCalled()
})
