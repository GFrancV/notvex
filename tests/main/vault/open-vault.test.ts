import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, describe, expect, it } from 'vitest'

import { dbRun } from '@main/db/queries'
import {
  closeVault,
  createVault,
  getDb,
  isVaultOpen,
  openVault,
  openVaultWithRecovery
} from '@main/vault/vault'

describe('openVault / openVaultWithRecovery cleanup (issues #17, #58)', () => {
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

  it('openVault() leaves a leftover .bak in place while still cleaning up a leftover .tmp (issue #17)', async () => {
    // Simulates a fresh app start finding leftovers of an older version's
    // failed rollback. That .bak may be the user's only recovery copy, so
    // cleanupOrphanedTempFiles() must leave it in place.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword)
    await closeVault()

    const backupPath = vaultPath + '.bak'
    const tmpPath = vaultPath + '.tmp'
    writeFileSync(backupPath, 'stale backup left by a previous crashed rollback')
    writeFileSync(tmpPath, 'stale atomicWrite temp file left by a previous crash')

    const reopened = await openVault(vaultPath, originalPassword)
    expect(reopened).not.toBeNull()

    expect(existsSync(backupPath)).toBe(true)
    expect(existsSync(tmpPath)).toBe(false)
  }, 60_000)

  it('openVaultWithRecovery() closes its connection and deletes its temp DB when vault_meta is missing (issue #58)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const password = 'correct horse battery staple'

    const { mnemonic } = await createVault(vaultPath, password)
    await dbRun(getDb(), 'DELETE FROM vault_meta')
    await closeVault() // repacks the container, persisting the deletion

    // On Linux/macOS unlink succeeds on an open file, so the temp-file check can't prove the close.
    // Database.prototype.close is non-configurable (vi.spyOn can't wrap it), but vault.ts reads
    // sqlcipher.Database on every call, so a swapped-in subclass can track each connection.
    const RealDatabase = sqlcipher.Database
    const connections: { path: string; closed: boolean }[] = []
    class TrackedDatabase extends RealDatabase {
      private readonly connection: { path: string; closed: boolean }
      constructor(filename: string, callback?: (err: Error | null) => void) {
        super(filename, callback)
        this.connection = { path: filename, closed: false }
        connections.push(this.connection)
      }
      close(callback?: (err: Error | null) => void): void {
        this.connection.closed = true
        super.close(callback)
      }
    }
    const mutableSqlcipher = sqlcipher as { Database: unknown }
    mutableSqlcipher.Database = TrackedDatabase
    try {
      await expect(openVaultWithRecovery(vaultPath, mnemonic)).resolves.toBeNull()
    } finally {
      mutableSqlcipher.Database = RealDatabase
    }
    expect(connections).toEqual([{ path: expect.any(String), closed: true }])

    expect(isVaultOpen()).toBe(false)
    // Checks only the file this call created, not a tmpdir snapshot, so other
    // processes creating notvex_*.db files concurrently can't affect it.
    for (const suffix of ['', '-wal', '-shm']) {
      expect(existsSync(connections[0].path + suffix)).toBe(false)
    }

    // The lock was released. The password path doesn't read vault_meta.
    await expect(openVault(vaultPath, password)).resolves.not.toBeNull()
  }, 60_000)

  it('openVaultWithRecovery() still returns null and cleans up when closing the connection fails on missing vault_meta (issue #58)', async () => {
    // Without its own try/catch, a close error in the !meta branch falls into
    // the outer catch, which rethrows: the caller would get an exception
    // instead of null.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const password = 'correct horse battery staple'

    const { mnemonic } = await createVault(vaultPath, password)
    await dbRun(getDb(), 'DELETE FROM vault_meta')
    await closeVault() // repacks the container, persisting the deletion

    // Same swap as the test above. This close really closes the connection,
    // then reports a failure to the caller.
    const RealDatabase = sqlcipher.Database
    const openedPaths: string[] = []
    class FailingCloseDatabase extends RealDatabase {
      constructor(filename: string, callback?: (err: Error | null) => void) {
        super(filename, callback)
        openedPaths.push(filename)
      }
      close(callback?: (err: Error | null) => void): void {
        super.close(() => callback?.(new Error('simulated close failure')))
      }
    }
    const mutableSqlcipher = sqlcipher as { Database: unknown }
    mutableSqlcipher.Database = FailingCloseDatabase
    try {
      await expect(openVaultWithRecovery(vaultPath, mnemonic)).resolves.toBeNull()
    } finally {
      mutableSqlcipher.Database = RealDatabase
    }

    expect(openedPaths).toHaveLength(1)
    expect(existsSync(openedPaths[0])).toBe(false)
    await expect(openVault(vaultPath, password)).resolves.not.toBeNull()
  }, 60_000)
})
