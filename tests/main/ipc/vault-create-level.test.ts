import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeWindow, invoke, loadIpcModules } from './confirmation-gates/harness'

// The level is the only crypto parameter the renderer picks, so main accepts only ids from the
// closed list and never forwards anything else to createVault.
describe('vault:create level', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let vault: typeof import('@main/vault/vault')

  beforeEach(async () => {
    ;({ ipc, vault } = await loadIpcModules())
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
  })

  it.each([
    ['a tier outside the list', 10],
    ['a non-integer', 4.5],
    ['a string', '4'],
    ['null', null]
  ])('rejects %s without calling createVault', async (_name, level) => {
    const res = await invoke('vault:create', '/v.nvx', 'a long enough password', level)

    expect(res).toMatchObject({ success: false })
    expect(vault.createVault).not.toHaveBeenCalled()
  })

  it('returns the error createVault throws as is', async () => {
    const message = "Couldn't create the vault: this computer doesn't have enough memory for it"
    vi.mocked(vault.createVault).mockRejectedValue(new Error(message))

    const res = await invoke('vault:create', '/v.nvx', 'a long enough password', 2)

    expect(res).toEqual({ success: false, error: message })
    expect(vault.createVault).toHaveBeenCalledWith('/v.nvx', 'a long enough password', true, 2)
  })
})
