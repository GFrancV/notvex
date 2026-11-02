/**
 * Keeps the master key out of OS crash dumps and away from same-user debuggers attaching to the
 * running app; a process launched under a debugger or with an injected library is out of reach.
 * Best effort, like memlock: a failure is logged and startup continues, so an odd environment
 * never locks a user out. Windows needs nothing: by default WER keeps only a crash signature, in a
 * folder the user can't read. Calling crashReporter.start() would undo this on Linux: its crash
 * handler makes the process dumpable again.
 */

import { readdirSync, readFileSync } from 'fs'
import koffi from 'koffi'

import { appendError } from './error-log'

type NativeFn = (...args: unknown[]) => number

const PR_SET_DUMPABLE = 4
const PT_DENY_ATTACH = 31

function applyPlatformFlag(): number {
  if (process.platform === 'linux') {
    // Non-dumpable: the kernel writes no core file and refuses same-user ptrace.
    const prctl = koffi
      .load('libc.so.6')
      .func(
        'int prctl(int option, unsigned long a2, unsigned long a3, unsigned long a4, unsigned long a5)'
      ) as unknown as NativeFn
    return prctl(PR_SET_DUMPABLE, 0, 0, 0, 0)
  }
  if (process.platform === 'darwin') {
    const ptrace = koffi
      .load('libSystem.B.dylib')
      .func('int ptrace(int request, int pid, void* addr, int data)') as unknown as NativeFn
    return ptrace(PT_DENY_ATTACH, 0, null, 0)
  }
  return 0
}

// PR_SET_DUMPABLE refuses new tracers but keeps one that attached first, and ptrace is per thread.
function tracedAtStart(): boolean {
  try {
    return readdirSync('/proc/self/task').some((tid) =>
      /^TracerPid:\s+[1-9]/m.test(readFileSync(`/proc/self/task/${tid}/status`, 'utf8'))
    )
  } catch {
    return false
  }
}

/** Returns false when startup must stop: a debugger attached before the hardening ran. */
export function hardenProcess(): boolean {
  let flagSet = false
  try {
    flagSet = applyPlatformFlag() === 0
  } catch {
    // a missing library counts as a failed call
  }
  if (!flagSet) {
    appendError('main', { reason: 'hardening-failed' })
    return true
  }
  if (process.platform === 'linux' && tracedAtStart()) {
    appendError('main', { reason: 'traced-at-start' })
    return false
  }
  return true
}
