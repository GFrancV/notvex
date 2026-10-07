import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { createNote } from '@main/db/queries'
import {
  closeVault,
  createVault,
  getDb,
  getMasterKey,
  isVaultOpen,
  openVault,
  packContainer,
  rotateVaultCredentials,
  syncContainer,
  withVaultLock
} from '@main/vault/vault'
import { readNoteTitlesFromPackedContainer, forceNextDbRunToFail } from './helpers'

describe('packContainer WAL checkpoint (issue #16 regression)', () => {
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

  it('persists notes written after vault creation once syncContainer() runs, without closing the vault', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    const NOTE_COUNT = 50
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }

    // Without packContainer()'s checkpoint, the main temp DB file alone
    // holds none of these WAL-mode commits, so this sync (no close) would
    // produce a container missing every note above.
    await syncContainer()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())

    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000) // real Argon2id calibration + KDF on vault creation

  it('persists notes written just before closeVault(), even without an explicit syncContainer() call', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    const NOTE_COUNT = 10
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Closing note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }

    // Characterization, not a negative control: SQLite implicitly
    // checkpoints WAL when the last connection closes, so this would pass
    // even if closeVault() closed `db` before packing. It proves the end
    // result, not closeVault()'s pack-then-close ordering.
    const masterKeyCopy = Buffer.from(getMasterKey())
    await closeVault()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, masterKeyCopy)
    masterKeyCopy.fill(0)

    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000)

  it('closeVault() is idempotent — a second call once nothing is open resolves without throwing', async () => {
    // A second close happens in practice, e.g. the auto-lock timer firing as the user locks.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    await closeVault()
    expect(isVaultOpen()).toBe(false)

    await expect(closeVault()).resolves.toEqual({ packFailed: false })
    expect(isVaultOpen()).toBe(false)
  }, 60_000)

  it("doesn't disrupt the session when packContainer() fails to write (vault directory removed)", async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')
    await createNote(getDb(), { title: 'Note', content: 'Body' }, getMasterKey())

    // tempDbPath lives in os.tmpdir(), independent of vaultDir, so
    // removing vaultDir breaks only the final atomicWrite — the
    // checkpoint and the temp-file read still succeed, isolating the
    // write failure syncContainer() is required to swallow.
    rmSync(vaultDir, { recursive: true, force: true })

    await expect(syncContainer()).resolves.toBeUndefined()
    expect(isVaultOpen()).toBe(true)
  }, 60_000)

  it('packContainer() rejects on the same write failure syncContainer() swallows (vault directory removed)', async () => {
    // vault:save-copy-as relies on this rejection (see its handler).
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')
    await createNote(getDb(), { title: 'Note', content: 'Body' }, getMasterKey())

    rmSync(vaultDir, { recursive: true, force: true })

    await expect(packContainer()).rejects.toThrow()
  }, 60_000)

  it('serializes packContainer() against rotateVaultCredentials() so a repack can never race a rekey', async () => {
    // Characterization only: rotateVaultCredentials()'s synchronous Argon2id blocks the thread
    // before its first await, so a passthrough lock wouldn't reliably fail this. The withVaultLock
    // ordering tests in with-vault-lock.test.ts prove serialization deterministically.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    const NOTE_COUNT = 5
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }

    const newPassword = 'a different correct horse battery staple'
    const rotation = rotateVaultCredentials(newPassword)
    const repack = packContainer()
    await Promise.all([rotation, repack])

    await closeVault()

    // Unlocking proves the header wasn't built from a stale key (HMAC mismatch → null).
    const reopened = await openVault(vaultPath, newPassword)
    expect(reopened).not.toBeNull()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())
    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000)

  it("doesn't deadlock when rotateVaultCredentials()'s rollback closes the vault", async () => {
    // The rollback closes from inside the (non-reentrant) lock. The race tells "rejected" from
    // "hung" in 10s instead of the full test timeout.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    const runSpy = forceNextDbRunToFail(
      (sql) => sql === 'BEGIN TRANSACTION',
      'simulated transaction failure'
    )

    try {
      const rotation = rotateVaultCredentials('a different correct horse battery staple')

      const outcome = await Promise.race([
        rotation.then(
          () => 'resolved' as const,
          () => 'rejected' as const
        ),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000))
      ])

      expect(outcome).toBe('rejected')
      await expect(rotation).rejects.toThrow('simulated transaction failure')
      expect(isVaultOpen()).toBe(false)

      // The queue is still usable, so doCloseVault() ran to completion.
      const pingOrder: string[] = []
      await withVaultLock(async () => {
        pingOrder.push('ping')
      })
      expect(pingOrder).toEqual(['ping'])
    } finally {
      runSpy.mockRestore()
    }
  }, 60_000)
})
