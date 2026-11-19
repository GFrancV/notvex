import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeWindow, invoke, loadIpcModules } from './confirmation-gates/harness'

describe('vault:get-kdf-level', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let vault: typeof import('@main/vault/vault')

  beforeEach(async () => {
    ;({ ipc, vault } = await loadIpcModules())
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
  })

  it("returns the open vault's level", async () => {
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)
    vi.mocked(vault.getKdfLevelFromOpenVault).mockReturnValue({ id: 10, memoryMiB: 32, passes: 2 })

    const res = await invoke('vault:get-kdf-level')

    expect(res).toEqual({ success: true, data: { id: 10, memoryMiB: 32, passes: 2 } })
  })
})

describe('vault:change-kdf-level', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let vault: typeof import('@main/vault/vault')

  beforeEach(async () => {
    ;({ ipc, vault } = await loadIpcModules())
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)
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
  ])('rejects %s without touching the vault', async (_name, level) => {
    const res = await invoke('vault:change-kdf-level', level, 'a password')

    expect(res).toMatchObject({ success: false })
    expect(vault.changePassword).not.toHaveBeenCalled()
  })

  it.each([
    ['without a key file', undefined],
    ['with a key file', new Uint8Array([1, 2, 3])]
  ])('re-keys under the same password at the chosen level, %s', async (_name, keyFile) => {
    vi.mocked(vault.changePassword).mockResolvedValue({ mnemonic: 'm' })

    await invoke('vault:change-kdf-level', 5, 'pw', keyFile)

    expect(vault.changePassword).toHaveBeenCalledExactlyOnceWith('pw', 'pw', keyFile, 5)
  })

  it.each([
    ['a wrong password', 'Incorrect password or key file'],
    ['a derivation that fails', 'Argon2 allocation failed']
  ])("says it couldn't change the level when %s", async (_name, reason) => {
    vi.mocked(vault.changePassword).mockRejectedValue(new Error(reason))

    const res = await invoke('vault:change-kdf-level', 5, 'a password')

    expect(res).toEqual({ success: false, error: `Couldn't change the level: ${reason}` })
  })
})
