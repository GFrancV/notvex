import koffi from 'koffi'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { appendError } from '@main/error-log'
import { hardenProcess } from '@main/process-hardening'

vi.mock('@main/error-log', () => ({ appendError: vi.fn() }))

const PR_GET_DUMPABLE = 3
const PR_SET_DUMPABLE = 4

function prctl(option: number, arg: number): number {
  const fn = koffi
    .load('libc.so.6')
    .func(
      'int prctl(int o, unsigned long a, unsigned long b, unsigned long c, unsigned long d)'
    ) as unknown as (...args: number[]) => number
  return fn(option, arg, 0, 0, 0)
}

// The other tests mock koffi, so a koffi upgrade or a bad signature that breaks the real call
// would pass them while the hardening silently stops.
describe.runIf(process.platform === 'linux')('hardenProcess on a real Linux kernel', () => {
  // The test worker must not stay non-dumpable for the rest of the run.
  afterAll(() => prctl(PR_SET_DUMPABLE, 1))

  it('leaves the process non-dumpable without logging', () => {
    expect(hardenProcess()).toBe(true)
    expect(appendError).not.toHaveBeenCalled()
    expect(prctl(PR_GET_DUMPABLE, 0)).toBe(0)
  })
})
