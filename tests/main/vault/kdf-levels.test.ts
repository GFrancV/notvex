import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readContainer } from '@main/vault/container'
import { deriveKey, getArgon2Params, measureKdfLevel } from '@main/vault/crypto'
import {
  changePassword,
  closeVault,
  createVault,
  getKdfLevelFromOpenVault,
  openVault,
  openVaultWithRecovery
} from '@main/vault/vault'
import { DEFAULT_KDF_LEVEL_ID, KDF_LEVELS } from '@shared/kdf-levels'

// Pass-through spy so one derivation can be made to fail like an Argon2 allocation error.
vi.mock('@main/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/crypto')>()
  return { ...actual, deriveKey: vi.fn(actual.deriveKey) }
})

// Lowered only while creating a vault, to stand in for one made before the length rule existed.
let passwordMinLength = 12
vi.mock('@shared/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/types')>()
  return {
    ...actual,
    get PASSWORD_MIN_LENGTH() {
      return passwordMinLength
    }
  }
})

const PASSWORD = 'correct horse battery staple'

describe('kdf levels', () => {
  let dir: string | undefined

  afterEach(async () => {
    await closeVault()
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('offers exactly 64, 128, 256 and 512 MiB at 3 passes, with 256 MiB as the default', () => {
    expect(KDF_LEVELS.map(({ memoryMiB, passes }) => [memoryMiB, passes])).toEqual([
      [64, 3],
      [128, 3],
      [256, 3],
      [512, 3]
    ])
    expect(KDF_LEVELS.find((level) => level.id === DEFAULT_KDF_LEVEL_ID)?.memoryMiB).toBe(256)
  })

  it('describes each level with the parameters main really derives with', () => {
    const salt = Buffer.alloc(16)

    for (const { id, memoryMiB, passes } of KDF_LEVELS) {
      const { params } = getArgon2Params({ version: 1, salt, kdfTier: id })

      expect(params, `level ${id}`).toEqual({
        memory: memoryMiB * 1024 * 1024,
        iterations: passes,
        parallelism: 1
      })
    }
  })

  it('measureKdfLevel times a real derivation and refuses a tier it does not know', async () => {
    const ms = await measureKdfLevel(7)

    expect(Number.isInteger(ms)).toBe(true)
    expect(ms).toBeGreaterThanOrEqual(0)
    await expect(measureKdfLevel(99)).rejects.toThrow('Unknown KDF tier: 99')
  }, 60_000)

  it('createVault without a level writes the 256 MiB tier to the header', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-kdf-'))
    const vaultPath = join(dir, 'v.nvx')

    await createVault(vaultPath, PASSWORD)

    // 4 is the 256 MiB / 3 passes tier id from the level table.
    expect(readContainer(readFileSync(vaultPath)).kdfInput.kdfTier).toBe(4)
  }, 60_000)

  it('createVault with a chosen level writes that level to the header', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-kdf-'))
    const vaultPath = join(dir, 'v.nvx')

    await createVault(vaultPath, PASSWORD, false, 7)

    // 7 is the 64 MiB / 3 passes tier id: differs from the default, so it can't pass by accident.
    expect(readContainer(readFileSync(vaultPath)).kdfInput.kdfTier).toBe(7)
  }, 60_000)

  it("createVault says the computer lacks the memory when the level can't run", async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-kdf-'))
    const vaultPath = join(dir, 'v.nvx')
    vi.mocked(deriveKey).mockImplementationOnce(() => {
      throw new Error('Argon2 allocation failed')
    })

    await expect(createVault(vaultPath, PASSWORD, false, 2)).rejects.toThrow(
      "Couldn't create the vault: this computer doesn't have enough memory for it"
    )
    expect(existsSync(vaultPath)).toBe(false)
  })

  it('changePassword with a target level re-encrypts the vault at that level and it opens with the same password', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-kdf-'))
    const vaultPath = join(dir, 'v.nvx')
    await createVault(vaultPath, PASSWORD, false, 7)

    // 5 is the 128 MiB / 3 passes tier id: differs from the 64 MiB the vault started at.
    await changePassword(PASSWORD, PASSWORD, undefined, 5)

    expect(readContainer(readFileSync(vaultPath)).kdfInput.kdfTier).toBe(5)
    await closeVault()
    await expect(openVault(vaultPath, PASSWORD)).resolves.not.toBeNull()
  }, 90_000)

  it('a level change with a wrong current password under 12 characters says the password is wrong', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-kdf-'))
    await createVault(join(dir, 'v.nvx'), PASSWORD, false, 7)

    await expect(changePassword('elevenchars', 'elevenchars', undefined, 5)).rejects.toThrow(
      'Incorrect password or key file'
    )
  }, 60_000)

  it('a vault whose password predates the 12-character rule can still change level', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-kdf-'))
    const vaultPath = join(dir, 'v.nvx')
    const shortPassword = 'eightchr'
    passwordMinLength = 0
    try {
      await createVault(vaultPath, shortPassword, false, 7)
    } finally {
      passwordMinLength = 12
    }

    await changePassword(shortPassword, shortPassword, undefined, 5)

    expect(readContainer(readFileSync(vaultPath)).kdfInput.kdfTier).toBe(5)
    await closeVault()
    await expect(openVault(vaultPath, shortPassword)).resolves.not.toBeNull()
  }, 90_000)

  it('getKdfLevelFromOpenVault describes the open vault, including a level outside the four', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-kdf-'))
    const vaultPath = join(dir, 'v.nvx')

    await createVault(vaultPath, PASSWORD, false, 7)
    expect(getKdfLevelFromOpenVault()).toEqual({ id: 7, memoryMiB: 64, passes: 3 })
    await closeVault()
    rmSync(vaultPath)

    // 10 is the legacy 32 MiB / 2 passes tier: not one of the four levels.
    await createVault(vaultPath, PASSWORD, false, 10)
    expect(getKdfLevelFromOpenVault()).toEqual({ id: 10, memoryMiB: 32, passes: 2 })
  }, 90_000)

  it('after a level change the previous recovery key no longer opens the vault and the new one does', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-kdf-'))
    const vaultPath = join(dir, 'v.nvx')
    const { mnemonic: previous } = await createVault(vaultPath, PASSWORD, false, 7)

    const { mnemonic: issued } = await changePassword(PASSWORD, PASSWORD, undefined, 5)

    await closeVault()
    await expect(openVaultWithRecovery(vaultPath, previous)).resolves.toBeNull()
    await expect(openVaultWithRecovery(vaultPath, issued)).resolves.not.toBeNull()
  }, 90_000)
})
