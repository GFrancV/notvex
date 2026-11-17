import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeWindow, invoke, loadIpcModules } from './confirmation-gates/harness'

// kdf:measure runs one real derivation, so the timing itself is mocked: these cover what main
// accepts and how it reports the result.
describe('kdf:measure', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let crypto: typeof import('@main/vault/crypto')

  beforeEach(async () => {
    ;({ ipc } = await loadIpcModules())
    crypto = await import('@main/vault/crypto')
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
  })

  it('returns the milliseconds for a valid level', async () => {
    vi.mocked(crypto.measureKdfLevel).mockResolvedValue(1234)

    const res = await invoke('kdf:measure', 4)

    expect(res).toEqual({ success: true, data: { status: 'measured', ms: 1234 } })
    expect(crypto.measureKdfLevel).toHaveBeenCalledWith(4)
  })

  it('reports the level as unavailable when the derivation fails', async () => {
    vi.mocked(crypto.measureKdfLevel).mockRejectedValue(new Error('Argon2 allocation failed'))

    const res = await invoke('kdf:measure', 2)

    expect(res).toEqual({ success: true, data: { status: 'unavailable' } })
  })

  it.each([
    ['a tier outside the list', 10],
    ['a non-integer', 4.5],
    ['a string', '4'],
    ['null', null]
  ])('rejects %s without measuring', async (_name, level) => {
    const res = await invoke('kdf:measure', level)

    expect(res).toMatchObject({ success: false })
    expect(crypto.measureKdfLevel).not.toHaveBeenCalled()
  })
})
