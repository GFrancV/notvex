import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { logError } from '@main/log'

const SECRET_PATH = join(tmpdir(), 'alice', 'Private Notes', 'diary.nvx')

describe('logError', () => {
  let log: MockInstance<typeof console.error>

  beforeEach(() => {
    log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    log.mockRestore()
  })

  function expectNoPath(): void {
    for (const arg of log.mock.calls[0]) expect(String(arg)).not.toContain(SECRET_PATH)
  }

  it('logs only the code of an fs error, not its message or path', () => {
    const e: NodeJS.ErrnoException = new Error(`ENOENT: no such file, open '${SECRET_PATH}'`)
    e.code = 'ENOENT'
    e.path = SECRET_PATH

    logError('[test] failed:', e)

    expect(log).toHaveBeenCalledExactlyOnceWith('[test] failed:', 'ENOENT')
    expectNoPath()
  })

  it('logs the name of an Error without a code', () => {
    logError('[test] failed:', new TypeError(`bad path ${SECRET_PATH}`))

    expect(log).toHaveBeenCalledExactlyOnceWith('[test] failed:', 'TypeError')
    expectNoPath()
  })

  it('logs only the type of a thrown non-Error', () => {
    logError('[test] failed:', SECRET_PATH)

    expect(log).toHaveBeenCalledExactlyOnceWith('[test] failed:', 'string')
    expectNoPath()
  })
})
