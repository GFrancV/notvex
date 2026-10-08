import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNote, getNote } from '@main/db/queries'
import { deriveKey, memzero } from '@main/vault/crypto'
import { allocSecure, freeSecure } from '@main/vault/memlock'
import {
  changePassword,
  closeVault,
  createVault,
  getDb,
  getMasterKey,
  isVaultOpen,
  openVault,
  rotateVaultCredentials
} from '@main/vault/vault'
import {
  ROTATION_CASES,
  readNoteTitlesFromPackedContainer,
  forceNextDbRunToFail,
  expectNewRawKeyZeroed
} from './helpers'

// Pass-through spies, as in key-zeroing.test.ts.
vi.mock('@main/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/crypto')>()
  return {
    ...actual,
    memzero: vi.fn(actual.memzero),
    deriveKey: vi.fn(actual.deriveKey)
  }
})

// Pass-through spies so a test can make one allocSecure()/freeSecure() throw. In a rotation
// those are storeKey(newRawKey) and the free of the old masterKey.
vi.mock('@main/vault/memlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/memlock')>()
  return { allocSecure: vi.fn(actual.allocSecure), freeSecure: vi.fn(actual.freeSecure) }
})

describe('credential rotation rollback (issues #17, #23, #39)', () => {
  let vaultDir: string | undefined

  afterEach(async () => {
    // Drop any unconsumed mockImplementationOnce() so it can't leak into closeVault() or the next
    // test; Vitest 4's mockReset() restores the vi.fn() pass-through.
    vi.mocked(allocSecure).mockReset()
    vi.mocked(freeSecure).mockReset()
    try {
      await closeVault()
    } catch {
      /* ignore */
    }
    if (vaultDir) rmSync(vaultDir, { recursive: true, force: true })
    vaultDir = undefined
  })

  // The notes are deliberately NOT synced before rotating: the rotation must
  // persist them itself before mutating anything, since its rollback closes
  // the session without packing.
  it('rotateVaultCredentials(): rolls back by closing the vault, which reopens with the original password and every note (issue #17)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)

    const NOTE_COUNT = 5
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }

    const runSpy = forceNextDbRunToFail(
      (sql) => sql === 'BEGIN TRANSACTION',
      'simulated transaction failure'
    )
    try {
      await expect(
        rotateVaultCredentials('a different correct horse battery staple')
      ).rejects.toThrow('simulated transaction failure')
    } finally {
      runSpy.mockRestore()
    }

    expect(isVaultOpen()).toBe(false)
    expect(existsSync(vaultPath + '.bak')).toBe(false)
    const reopened = await openVault(vaultPath, originalPassword)
    expect(reopened).not.toBeNull()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())
    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
    // 2 real Argon2id derivations (createVault + rotateVaultCredentials)
  }, 90_000)

  it('changePassword(): a second rotation in the same open session accepts the password the first rotation just set', async () => {
    // Guards commitRotatedContainer()'s metadata re-read (see its comment).
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const firstPassword = 'correct horse battery staple'
    const secondPassword = 'a different correct horse battery staple'

    await createVault(vaultPath, firstPassword)
    await changePassword(firstPassword, secondPassword)

    await expect(
      changePassword(secondPassword, 'yet another correct horse battery staple')
    ).resolves.toMatchObject({ mnemonic: expect.any(String) })
  }, 90_000)

  // The rekey sits inside the rollback try, so its failure must close the
  // session. isVaultOpen() is the assertion that matters: the mocked rekey
  // never actually re-keys the connection, so the reopen check alone would
  // pass either way.
  it.each(ROTATION_CASES)(
    '$name(): runs the rollback, closing the vault, when the PRAGMA rekey to the new key fails (issue #39)',
    async ({ prepare }) => {
      vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
      const vaultPath = join(vaultDir, 'test.nvx')
      const { rotate, reopenWithOriginal } = await prepare(vaultPath)

      const runSpy = forceNextDbRunToFail(
        (sql) => sql.startsWith('PRAGMA rekey'),
        'simulated rekey failure'
      )
      try {
        await expect(rotate()).rejects.toThrow('simulated rekey failure')
      } finally {
        runSpy.mockRestore()
      }

      expect(isVaultOpen()).toBe(false)
      expect(await reopenWithOriginal()).not.toBeNull()
    },
    90_000
  )

  // storeKey(newRawKey) runs before the new container is written, so an
  // allocation failure there must roll back over an intact file on disk.
  it.each(ROTATION_CASES)(
    '$name(): rolls back cleanly when allocating the new secure key fails before the new container is written (issue #23)',
    async ({ prepare, deriveKeyCalls }) => {
      vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
      const vaultPath = join(vaultDir, 'test.nvx')
      const { rotate, reopenWithOriginal } = await prepare(vaultPath)

      const deriveKeySpy = vi.mocked(deriveKey)
      const memzeroSpy = vi.mocked(memzero)
      deriveKeySpy.mockClear()
      memzeroSpy.mockClear()
      vi.mocked(allocSecure).mockImplementationOnce(() => {
        throw new Error('simulated allocSecure failure')
      })
      await expect(rotate()).rejects.toThrow('simulated allocSecure failure')

      // storeKey() threw before its own memzero(rawKey): only the outer
      // finally is left to wipe newRawKey.
      expectNewRawKeyZeroed(deriveKeySpy, memzeroSpy, deriveKeyCalls)
      expect(isVaultOpen()).toBe(false)
      expect(await reopenWithOriginal()).not.toBeNull()
    },
    90_000
  )

  // Once the new container is committed, the rotation has
  // succeeded — a failure freeing the OLD key must not trigger a rollback,
  // which would discard a session whose new-keyed container is on disk.
  it.each(ROTATION_CASES)(
    '$name(): still succeeds and never rolls back when freeing the old key fails after the commit (issue #23)',
    async ({ prepare }) => {
      vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
      const vaultPath = join(vaultDir, 'test.nvx')
      const { rotate, reopenWithNew } = await prepare(vaultPath)

      // The live masterKey buffer itself, not a copy — the rotation's
      // fallback must still wipe it even though freeSecure() threw.
      const oldKey = getMasterKey()
      const freeSpy = vi.mocked(freeSecure)
      freeSpy.mockClear() // removeKeyFile's prepare() already freed keys
      freeSpy.mockImplementationOnce(() => {
        throw new Error('simulated freeSecure failure')
      })
      await expect(rotate()).resolves.toMatchObject({ mnemonic: expect.any(String) })

      // The injected failure really hit the old key's free, after the swap.
      expect(freeSpy.mock.calls[0][0]).toBe(oldKey)
      expect(getMasterKey()).not.toBe(oldKey)
      expect(Array.from(oldKey).every((byte) => byte === 0)).toBe(true)
      expect(isVaultOpen()).toBe(true)
      await closeVault()
      expect(await reopenWithNew()).not.toBeNull()
    },
    90_000
  )

  // Makes commitRotatedContainer()'s atomicWrite() fail for real: the
  // directory squatting on its .tmp path is created inside the
  // storeKey(newRawKey) allocation, i.e. after the rotation's own pre-mutation
  // pack (which would otherwise hit it first) and right before the write.
  function failNextContainerWrite(vaultPath: string): void {
    const realAllocSecure = vi.mocked(allocSecure).getMockImplementation()!
    vi.mocked(allocSecure).mockImplementationOnce((size) => {
      mkdirSync(vaultPath + '.tmp')
      return realAllocSecure(size)
    })
  }

  // commitRotatedContainer() allocates the new secure key before
  // writing anything, so when the write itself fails that key must be freed
  // (and thus wiped) before the rollback runs.
  it.each(ROTATION_CASES)(
    '$name(): frees the new secure key and rolls back when writing the new container fails (issue #23)',
    async ({ prepare }) => {
      vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
      const vaultPath = join(vaultDir, 'test.nvx')
      const { rotate, reopenWithOriginal } = await prepare(vaultPath)

      const allocSpy = vi.mocked(allocSecure)
      const freeSpy = vi.mocked(freeSecure)
      allocSpy.mockClear()
      freeSpy.mockClear()
      failNextContainerWrite(vaultPath)
      await expect(rotate()).rejects.toMatchObject({
        code: expect.stringMatching(/^(EISDIR|EPERM)$/)
      })

      // The last allocation before the write is storeKey(newRawKey).
      const newSecureKey = allocSpy.mock.results.at(-1)!.value as Buffer
      expect(freeSpy.mock.calls.some(([buf]) => buf === newSecureKey)).toBe(true)
      expect(Array.from(newSecureKey).every((byte) => byte === 0)).toBe(true)

      expect(isVaultOpen()).toBe(false)
      rmSync(vaultPath + '.tmp', { recursive: true })
      expect(await reopenWithOriginal()).not.toBeNull()
    },
    90_000
  )

  // The note is deliberately NOT synced first: the rollback closes without packing (see
  // rollbackCredentialRotation()), so this proves the rotation packed pending writes first.
  it.each(ROTATION_CASES)(
    '$name(): keeps unsynced note content intact when a failure after the notes COMMIT rolls back',
    async ({ prepare }) => {
      vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
      const vaultPath = join(vaultDir, 'test.nvx')
      const { rotate, reopenWithOriginal } = await prepare(vaultPath)
      const note = await createNote(
        getDb(),
        { title: 'Unsynced', content: 'unsynced body' },
        getMasterKey()
      )

      failNextContainerWrite(vaultPath)
      await expect(rotate()).rejects.toThrow()

      // The session can't safely continue after this rollback.
      expect(isVaultOpen()).toBe(false)
      rmSync(vaultPath + '.tmp', { recursive: true })
      expect(await reopenWithOriginal()).not.toBeNull()
      const reopened = await getNote(getDb(), note.id, getMasterKey())
      expect(reopened?.content).toBe('unsynced body')
    },
    90_000
  )
})
