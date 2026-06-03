/**
 * memlock.ts — Prevents the masterKey from being paged to disk by the OS.
 *
 * Allocates key material outside V8's GC heap (Buffer.allocUnsafeSlow) and
 * pins the memory page with VirtualLock (Windows) / mlock (Linux, macOS).
 * Gracefully degrades to plain zeroing if koffi is unavailable.
 *
 * Why this matters: on a system under memory pressure the OS can swap any
 * unlocked page to disk. A locked page stays in RAM — an attacker with
 * physical access to the drive cannot find the key in the pagefile/swapfile.
 */

let _lock: ((buf: Buffer) => void) | null = null
let _unlock: ((buf: Buffer) => void) | null = null

;(function initMemlock(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')

    if (process.platform === 'win32') {
      const k32 = koffi.load('kernel32.dll')
      const vlock   = k32.func('bool VirtualLock(void* lpAddress, size_t dwSize)')
      const vunlock = k32.func('bool VirtualUnlock(void* lpAddress, size_t dwSize)')
      _lock   = (buf) => { vlock(buf, buf.byteLength) }
      _unlock = (buf) => { vunlock(buf, buf.byteLength) }
    } else if (process.platform === 'linux' || process.platform === 'darwin') {
      const lib = koffi.load(process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6')
      const mlock   = lib.func('int mlock(const void* addr, size_t len)')
      const munlock = lib.func('int munlock(const void* addr, size_t len)')
      _lock   = (buf) => { mlock(buf, buf.byteLength) }
      _unlock = (buf) => { munlock(buf, buf.byteLength) }
    }
  } catch {
    // koffi unavailable — memory locking disabled, app still works normally
  }
})()

/**
 * Allocates a Buffer in native heap (outside V8 GC) and locks the page in RAM.
 * Use for key material that must never reach disk.
 */
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

export const memlockAvailable = _lock !== null
