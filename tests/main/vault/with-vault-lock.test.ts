import { describe, expect, it, vi } from 'vitest'

import { withVaultLock } from '@main/vault/vault'

// Pure ordering tests — no vault/crypto involved, deliberately fast and
// deterministic. Proving a race is closed needs controlled timing, which
// real Argon2id/SQLCipher calls can't reliably provide.
describe('withVaultLock (issue #16 follow-up: concurrency hardening)', () => {
  it('runs queued calls strictly after the one already in flight settles', async () => {
    const order: string[] = []

    // `first` finishes after a real (if short) delay; `second` finishes
    // immediately once it runs. If withVaultLock let them run concurrently,
    // `second` would push before `first` despite being queued after it.
    const first = withVaultLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('first')
    })
    const second = withVaultLock(async () => {
      order.push('second')
    })

    await first
    await second

    expect(order).toEqual(['first', 'second'])
  })

  it('still runs a queued call after the one ahead of it rejects', async () => {
    const order: string[] = []

    const first = withVaultLock(async () => {
      order.push('first')
      throw new Error('boom')
    })
    const second = withVaultLock(async () => {
      order.push('second')
    })

    await expect(first).rejects.toThrow('boom')
    await second

    expect(order).toEqual(['first', 'second'])
  })

  // closeVault() hands doCloseVault(skipPack = false) to the queue by
  // reference, so a forwarded predecessor value would land in skipPack and
  // skip the pack on close.
  it('calls fn with no arguments after a predecessor that resolves with a value', async () => {
    void withVaultLock(async () => ['truthy'])
    const fn = vi.fn(async () => undefined)

    await withVaultLock(fn)

    expect(fn).toHaveBeenCalledWith()
  })

  it('calls fn with no arguments after a predecessor that rejects', async () => {
    withVaultLock(async () => {
      throw new Error('boom')
    }).catch(() => undefined)
    const fn = vi.fn(async () => undefined)

    await withVaultLock(fn)

    expect(fn).toHaveBeenCalledWith()
  })

  it('deadlocks permanently on a reentrant call — this is why closeVault()s catch-block fallbacks call doCloseVault() directly, never closeVault()', async () => {
    // Pins non-reentrancy so it's never "fixed" into tolerating a nested call. Runs on a freshly
    // imported module (vi.resetModules()) because this wedges its vaultOpLock forever.
    vi.resetModules()
    const { withVaultLock: isolatedWithVaultLock } = await import('@main/vault/vault')

    const reentrant = isolatedWithVaultLock(async () => {
      await isolatedWithVaultLock(async () => {})
    })

    const outcome = await Promise.race([
      reentrant.then(
        () => 'resolved' as const,
        () => 'rejected' as const
      ),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500))
    ])

    expect(outcome).toBe('timeout')

    // The statically imported lock every other test uses is untouched.
    await expect(withVaultLock(async () => 'still-fine' as const)).resolves.toBe('still-fine')
  })
})
