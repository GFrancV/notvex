import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appendError } from '@main/error-log'
import { hardenProcess } from '@main/process-hardening'

const native = vi.hoisted(() => vi.fn<(...args: unknown[]) => number>(() => 0))
const func = vi.hoisted(() => vi.fn<(signature: string) => typeof native>(() => native))
const load = vi.hoisted(() => vi.fn<(name: string) => unknown>(() => ({ func })))
const readdir = vi.hoisted(() => vi.fn<(path: string) => string[]>(() => ['1']))
const readFile = vi.hoisted(() => vi.fn<(path: string) => string>(() => 'TracerPid:\t0\n'))

vi.mock('koffi', () => ({ default: { load } }))
vi.mock('@main/error-log', () => ({ appendError: vi.fn() }))
vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  readdirSync: readdir,
  readFileSync: readFile
}))

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('hardenProcess', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => setPlatform(originalPlatform))

  it('makes the process non-dumpable on Linux', () => {
    setPlatform('linux')
    expect(hardenProcess()).toBe(true)
    expect(load).toHaveBeenCalledWith('libc.so.6')
    expect(func).toHaveBeenCalledWith(expect.stringContaining('prctl('))
    expect(native).toHaveBeenCalledWith(4, 0, 0, 0, 0)
    expect(appendError).not.toHaveBeenCalled()
  })

  it('denies debugger attach on macOS', () => {
    setPlatform('darwin')
    expect(hardenProcess()).toBe(true)
    expect(load).toHaveBeenCalledWith('libSystem.B.dylib')
    expect(func).toHaveBeenCalledWith(expect.stringContaining('ptrace('))
    expect(native).toHaveBeenCalledWith(31, 0, null, 0)
    expect(appendError).not.toHaveBeenCalled()
  })

  it('leaves Windows untouched', () => {
    setPlatform('win32')
    expect(hardenProcess()).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(appendError).not.toHaveBeenCalled()
  })

  it('logs once and carries on when the call returns an error', () => {
    setPlatform('linux')
    native.mockReturnValueOnce(-1)
    expect(hardenProcess()).toBe(true)
    expect(appendError).toHaveBeenCalledOnce()
    expect(appendError).toHaveBeenCalledWith('main', { reason: 'hardening-failed' })
  })

  it('logs once and carries on when the library fails to load', () => {
    setPlatform('linux')
    load.mockImplementationOnce(() => {
      throw new Error('no libc')
    })
    expect(hardenProcess()).toBe(true)
    expect(appendError).toHaveBeenCalledOnce()
    expect(appendError).toHaveBeenCalledWith('main', { reason: 'hardening-failed' })
  })

  it('stops startup when a thread was traced before the flag was set', () => {
    setPlatform('linux')
    readdir.mockReturnValueOnce(['1', '2'])
    readFile.mockReturnValueOnce('TracerPid:\t0\n').mockReturnValueOnce('TracerPid:\t4242\n')
    expect(hardenProcess()).toBe(false)
    expect(appendError).toHaveBeenCalledOnce()
    expect(appendError).toHaveBeenCalledWith('main', { reason: 'traced-at-start' })
  })

  it('carries on silently when /proc cannot be read', () => {
    setPlatform('linux')
    readdir.mockImplementationOnce(() => {
      throw new Error('no /proc')
    })
    expect(hardenProcess()).toBe(true)
    expect(appendError).not.toHaveBeenCalled()
  })

  it('does not look for tracers on macOS', () => {
    setPlatform('darwin')
    hardenProcess()
    expect(readdir).not.toHaveBeenCalled()
  })
})
