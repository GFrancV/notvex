/**
 * Key buffers outside V8's heap, page-locked with VirtualLock / mlock so the OS can't swap the
 * key to disk. Best effort: if koffi is missing or a lock call fails, only zeroing remains.
 */

import koffi from 'koffi'

type MemFn = (buf: Buffer, size: number) => void

let _lock: ((buf: Buffer) => void) | null = null
let _unlock: ((buf: Buffer) => void) | null = null

try {
  if (process.platform === 'win32') {
    const k32 = koffi.load('kernel32.dll')
    const vlock = k32.func('bool VirtualLock(void* lpAddress, size_t dwSize)') as unknown as MemFn
    const vunlock = k32.func(
      'bool VirtualUnlock(void* lpAddress, size_t dwSize)'
    ) as unknown as MemFn
    _lock = (buf): void => {
      vlock(buf, buf.byteLength)
    }
    _unlock = (buf): void => {
      vunlock(buf, buf.byteLength)
    }
  } else if (process.platform === 'linux' || process.platform === 'darwin') {
    const libName = process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6'
    const lib = koffi.load(libName)
    const mlock = lib.func('int mlock(const void* addr, size_t len)') as unknown as MemFn
    const munlock = lib.func('int munlock(const void* addr, size_t len)') as unknown as MemFn
    _lock = (buf): void => {
      mlock(buf, buf.byteLength)
    }
    _unlock = (buf): void => {
      munlock(buf, buf.byteLength)
    }
  }
} catch {
  // koffi unavailable — memory locking disabled, app still works normally
}

/** Use for key material that must never reach disk. */
export function allocSecure(size: number): Buffer {
  // allocUnsafeSlow: dedicated allocation, not drawn from the shared 8-KB pool.
  // This gives us a stable, uniquely-owned address — required for VirtualLock.
  const buf = Buffer.allocUnsafeSlow(size)
  buf.fill(0)
  _lock?.(buf)
  return buf
}

/**
 * Zeros a secure Buffer and releases the memory lock.
 * Always call this instead of memzero() for Buffers allocated with allocSecure().
 */
export function freeSecure(buf: Buffer): void {
  // Zero first, then unlock — ensures the OS never sees the key in the pagefile
  // even during the brief window between unlock and deallocation.
  buf.fill(0)
  _unlock?.(buf)
}
