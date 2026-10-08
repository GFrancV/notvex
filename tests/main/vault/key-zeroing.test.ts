import { randomBytes } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveKey, memzero } from '@main/vault/crypto'
import {
  changePassword,
  closeVault,
  configureKeyFile,
  createVault,
  removeKeyFile,
  rotateVaultCredentials
} from '@main/vault/vault'
import {
  forceNextDbRunToFail,
  expectNewRawKeyZeroed,
  expectNewRawKeyCopiesZeroed,
  expectNewRawKeyZeroedTwice,
  expectVerifyKeyMemzeroed
} from './helpers'

// Pass-through spies: tests capture the exact buffer a rotation derives and prove that
// instance is wiped, not merely that some memzero() ran.
vi.mock('@main/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/crypto')>()
  return {
    ...actual,
    memzero: vi.fn(actual.memzero),
    deriveKey: vi.fn(actual.deriveKey)
  }
})

describe('master key zeroing on vault creation and credential rotation (issues #24, #38, #40, #81)', () => {
  let vaultDir: string | undefined

  afterEach(async () => {
    try {
      await closeVault()
    } catch {
      /* ignore */
    }
    if (vaultDir) rmSync(vaultDir, { recursive: true, force: true })
    vaultDir = undefined
  })

  it('createVault(): zeroes every Buffer.from(rawKey) copy of the new master key (issue #81)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    const deriveKeySpy = vi.mocked(deriveKey)
    deriveKeySpy.mockClear()
    const bufferFromSpy = vi.spyOn(Buffer, 'from')

    try {
      await createVault(vaultPath, 'correct horse battery staple')

      expect(deriveKeySpy).toHaveBeenCalledTimes(1)
      const rawKeyRef = deriveKeySpy.mock.results[0].value as Uint8Array
      // Only the writeContainer masterKey copy: applyKey must not copy the key at all.
      expectNewRawKeyCopiesZeroed(bufferFromSpy, rawKeyRef, 1)
    } finally {
      bufferFromSpy.mockRestore()
    }
  }, 60_000)

  it('rotateVaultCredentials(): zeroes newRawKey even when the PRAGMA rekey to the new key fails (issue #24)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const runSpy = forceNextDbRunToFail(
      (sql) => sql.startsWith('PRAGMA rekey'),
      'simulated rekey failure'
    )

    // No authenticateVaultKey() step here: the only deriveKey() call is newRawKey.
    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()

    try {
      await expect(
        rotateVaultCredentials('a different correct horse battery staple')
      ).rejects.toThrow('simulated rekey failure')
    } finally {
      runSpy.mockRestore()
    }

    expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, 1)
  }, 90_000)

  it('rotateVaultCredentials(): zeroes newRawKey when the transaction fails and rollback runs (issue #24)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const runSpy = forceNextDbRunToFail(
      (sql) => sql === 'BEGIN TRANSACTION',
      'simulated transaction failure'
    )

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()

    try {
      await expect(
        rotateVaultCredentials('a different correct horse battery staple')
      ).rejects.toThrow('simulated transaction failure')
    } finally {
      runSpy.mockRestore()
    }

    expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, 1)
  }, 90_000)

  it('rotateVaultCredentials(): zeroes the newHex and writeContainer Buffer.from(newRawKey) copies on the success path (issues #38, #40)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()
    const bufferFromSpy = vi.spyOn(Buffer, 'from')

    try {
      await expect(
        rotateVaultCredentials('a different correct horse battery staple')
      ).resolves.toMatchObject({ mnemonic: expect.any(String) })

      // No authenticateVaultKey() step here: the only deriveKey() call is newRawKey.
      const newRawKeyRef = deriveKeySpy.mock.results[0].value as Uint8Array
      expectNewRawKeyCopiesZeroed(bufferFromSpy, newRawKeyRef, 2)
      expectNewRawKeyZeroedTwice(memzeroSpy, newRawKeyRef)
    } finally {
      bufferFromSpy.mockRestore()
    }
  }, 90_000)

  it('changePassword(): zeroes newRawKey even when the PRAGMA rekey to the new key fails (issue #24)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const runSpy = forceNextDbRunToFail(
      (sql) => sql.startsWith('PRAGMA rekey'),
      'simulated rekey failure'
    )

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()

    try {
      await expect(
        changePassword(originalPassword, 'a different correct horse battery staple')
      ).rejects.toThrow('simulated rekey failure')
    } finally {
      runSpy.mockRestore()
    }

    // Call 1 = authenticateVaultKey()'s verification derive; call 2 = newRawKey.
    expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, 2)
  }, 90_000)

  it('changePassword(): zeroes newRawKey when the transaction fails and rollback runs (issue #24)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const runSpy = forceNextDbRunToFail(
      (sql) => sql === 'BEGIN TRANSACTION',
      'simulated transaction failure'
    )

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()

    try {
      await expect(
        changePassword(originalPassword, 'a different correct horse battery staple')
      ).rejects.toThrow('simulated transaction failure')
    } finally {
      runSpy.mockRestore()
    }

    expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, 2)
  }, 90_000)

  it('changePassword(): zeroes the newHex and writeContainer Buffer.from(newRawKey) copies on the success path (issues #38, #40)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()
    const bufferFromSpy = vi.spyOn(Buffer, 'from')

    try {
      await expect(
        changePassword(originalPassword, 'a different correct horse battery staple')
      ).resolves.toMatchObject({ mnemonic: expect.any(String) })

      // Call 1 = authenticateVaultKey()'s verification derive; call 2 = newRawKey.
      const newRawKeyRef = deriveKeySpy.mock.results[1].value as Uint8Array
      expectNewRawKeyCopiesZeroed(bufferFromSpy, newRawKeyRef, 2)
      expectNewRawKeyZeroedTwice(memzeroSpy, newRawKeyRef)
      expectVerifyKeyMemzeroed(bufferFromSpy, deriveKeySpy.mock.results[0].value, memzeroSpy)
    } finally {
      bufferFromSpy.mockRestore()
    }
  }, 90_000)

  it('configureKeyFile(): zeroes newRawKey even when the PRAGMA rekey to the new key fails (issue #24)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const runSpy = forceNextDbRunToFail(
      (sql) => sql.startsWith('PRAGMA rekey'),
      'simulated rekey failure'
    )

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()

    const keyFileContents = randomBytes(32)
    try {
      await expect(configureKeyFile(originalPassword, keyFileContents)).rejects.toThrow(
        'simulated rekey failure'
      )
    } finally {
      runSpy.mockRestore()
    }

    // Call 1 = authenticateVaultKey()'s verification derive; call 2 = newRawKey.
    expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, 2)
  }, 90_000)

  it('configureKeyFile(): zeroes newRawKey when the transaction fails and rollback runs (issue #24)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const runSpy = forceNextDbRunToFail(
      (sql) => sql === 'BEGIN TRANSACTION',
      'simulated transaction failure'
    )

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()

    const keyFileContents = randomBytes(32)
    try {
      await expect(configureKeyFile(originalPassword, keyFileContents)).rejects.toThrow(
        'simulated transaction failure'
      )
    } finally {
      runSpy.mockRestore()
    }

    expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, 2)
  }, 90_000)

  it('configureKeyFile(): zeroes the newHex and writeContainer Buffer.from(newRawKey) copies on the success path (issues #38, #40)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()
    const bufferFromSpy = vi.spyOn(Buffer, 'from')

    const keyFileContents = randomBytes(32)
    try {
      await expect(configureKeyFile(originalPassword, keyFileContents)).resolves.toMatchObject({
        mnemonic: expect.any(String)
      })

      // Call 1 = authenticateVaultKey()'s verification derive; call 2 = newRawKey.
      const newRawKeyRef = deriveKeySpy.mock.results[1].value as Uint8Array
      expectNewRawKeyCopiesZeroed(bufferFromSpy, newRawKeyRef, 2)
      expectNewRawKeyZeroedTwice(memzeroSpy, newRawKeyRef)
      expectVerifyKeyMemzeroed(bufferFromSpy, deriveKeySpy.mock.results[0].value, memzeroSpy)
    } finally {
      bufferFromSpy.mockRestore()
    }
  }, 90_000)

  it('removeKeyFile(): zeroes newRawKey even when the PRAGMA rekey to the new key fails (issue #24)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    // removeKeyFile() requires a key file to already be configured.
    const keyFileContents = randomBytes(32)
    await configureKeyFile(originalPassword, keyFileContents)

    const runSpy = forceNextDbRunToFail(
      (sql) => sql.startsWith('PRAGMA rekey'),
      'simulated rekey failure'
    )

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()

    try {
      await expect(removeKeyFile(originalPassword, keyFileContents)).rejects.toThrow(
        'simulated rekey failure'
      )
    } finally {
      runSpy.mockRestore()
    }

    // Call 1 = authenticateVaultKey()'s verification derive; call 2 = newRawKey.
    expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, 2)
  }, 90_000)

  it('removeKeyFile(): zeroes newRawKey when the transaction fails and rollback runs (issue #24)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const keyFileContents = randomBytes(32)
    await configureKeyFile(originalPassword, keyFileContents)

    const runSpy = forceNextDbRunToFail(
      (sql) => sql === 'BEGIN TRANSACTION',
      'simulated transaction failure'
    )

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()

    try {
      await expect(removeKeyFile(originalPassword, keyFileContents)).rejects.toThrow(
        'simulated transaction failure'
      )
    } finally {
      runSpy.mockRestore()
    }

    expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, 2)
  }, 90_000)

  it('removeKeyFile(): zeroes the newHex and writeContainer Buffer.from(newRawKey) copies on the success path (issues #38, #40)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const keyFileContents = randomBytes(32)
    await configureKeyFile(originalPassword, keyFileContents)

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()
    const bufferFromSpy = vi.spyOn(Buffer, 'from')

    try {
      await expect(removeKeyFile(originalPassword, keyFileContents)).resolves.toMatchObject({
        mnemonic: expect.any(String)
      })

      // Call 1 = authenticateVaultKey()'s verification derive; call 2 = newRawKey.
      const newRawKeyRef = deriveKeySpy.mock.results[1].value as Uint8Array
      expectNewRawKeyCopiesZeroed(bufferFromSpy, newRawKeyRef, 2)
      expectNewRawKeyZeroedTwice(memzeroSpy, newRawKeyRef)
      expectVerifyKeyMemzeroed(bufferFromSpy, deriveKeySpy.mock.results[0].value, memzeroSpy)
    } finally {
      bufferFromSpy.mockRestore()
    }
  }, 90_000)

  it('changePassword(): rejects a wrong current password and zeroes the verify key via memzero (issue #40)', async () => {
    // Covers authenticateVaultKey()'s HMAC-mismatch branch.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    const deriveKeySpy = vi.mocked(deriveKey)
    const memzeroSpy = vi.mocked(memzero)
    deriveKeySpy.mockClear()
    memzeroSpy.mockClear()
    const bufferFromSpy = vi.spyOn(Buffer, 'from')

    try {
      await expect(
        changePassword('not the password', 'a different correct horse battery staple')
      ).rejects.toThrow('Current password is incorrect')

      // Only the verification derive runs; it never reaches newRawKey.
      expect(deriveKeySpy).toHaveBeenCalledTimes(1)
      expectVerifyKeyMemzeroed(bufferFromSpy, deriveKeySpy.mock.results[0].value, memzeroSpy)
    } finally {
      bufferFromSpy.mockRestore()
    }
  }, 90_000)
})
