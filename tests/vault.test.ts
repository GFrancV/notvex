import { randomBytes } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNote, dbAll } from '../src/main/db/queries'
import { readContainer } from '../src/main/vault/container'
import { decryptField } from '../src/main/vault/crypto'
import {
  changePassword,
  closeVault,
  configureKeyFile,
  createVault,
  getDb,
  getMasterKey,
  isVaultOpen,
  openVault,
  packContainer,
  removeKeyFile,
  rotateVaultCredentials,
  syncContainer,
  withVaultLock
} from '../src/main/vault/vault'

interface RawNoteRow {
  id: string
  title: Buffer
  title_iv: Buffer
}

// Opens a throwaway connection directly on the .nvx container's packed DB
// bytes and decrypts every note title. Simulates a fresh process reading
// the file from disk right now — independent of the live in-memory
// session, which would trivially "see" notes even if they never made it
// to disk.
async function readNoteTitlesFromPackedContainer(
  vaultPath: string,
  masterKey: Uint8Array
): Promise<Map<string, string>> {
  const fileBytes = readFileSync(vaultPath)
  const metadata = readContainer(fileBytes)
  const dbPath = join(tmpdir(), `notvex_test_read_${randomBytes(8).toString('hex')}.db`)
  writeFileSync(dbPath, fileBytes.subarray(metadata.dbOffset))

  const hex = Buffer.from(masterKey).toString('hex')
  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlcipher.Database(dbPath, (err) =>
      err ? reject(err) : resolve(database)
    )
  })

  try {
    await new Promise<void>((resolve, reject) => {
      db.run(`PRAGMA key = "x'${hex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
    })
    const rows = await dbAll<RawNoteRow>(db, 'SELECT id, title, title_iv FROM notes')
    const titles = new Map<string, string>()
    for (const row of rows) {
      titles.set(
        row.id,
        decryptField(new Uint8Array(row.title), new Uint8Array(row.title_iv), masterKey)
      )
    }
    return titles
  } finally {
    await new Promise<void>((resolve) => db.close(() => resolve()))
    try {
      unlinkSync(dbPath)
    } catch {
      /* ignore */
    }
  }
}

// Shared by the double-failure regression tests below for all 4
// credential-rotation functions: they share the exact same catch-block
// restructure (see vault.ts), reached the exact same way — the primary
// operation fails inside its transaction (BEGIN TRANSACTION), then the
// rollback rekey back to the old key also fails. Mocks the live
// connection's `run` accordingly, runs `action`, and returns the rejection
// for the caller to assert on. Does NOT interfere with authenticateVaultKey()
// (used by changePassword/configureKeyFile/removeKeyFile to verify the
// caller's current credentials before any of this) — that opens its own
// short-lived connection, never the live `db` mocked here.
async function triggerDoubleRollbackFailure(action: () => Promise<unknown>): Promise<Error> {
  const liveDb = getDb()
  const originalRun = liveDb.run.bind(liveDb)
  let rekeyCalls = 0
  const runSpy = vi.spyOn(liveDb, 'run').mockImplementation((sql: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as (err: Error | null) => void
    if (typeof sql === 'string' && sql === 'BEGIN TRANSACTION') {
      callback(new Error('simulated transaction failure'))
      return liveDb
    }
    if (typeof sql === 'string' && sql.startsWith('PRAGMA rekey')) {
      rekeyCalls += 1
      if (rekeyCalls === 2) {
        callback(new Error('simulated rollback rekey failure'))
        return liveDb
      }
    }
    return originalRun(sql, ...(rest as Parameters<typeof originalRun>[]))
  })

  try {
    await action()
  } catch (err) {
    return err as Error
  } finally {
    runSpy.mockRestore()
  }
  // Outside the try/catch above so it's never mistaken for action()'s own
  // rejection — a caller asserting on the returned error's message would
  // otherwise get a confusing "expected action() to reject" instead of
  // learning that action() unexpectedly succeeded.
  throw new Error('expected action() to reject, but it resolved')
}

// Shared by the 4 credential-rotation double-failure tests below: asserts
// the standard outcome of the rollback-also-fails path — an actionable
// error naming backupPath, the vault closed, and the backup kept on disk.
function expectRestoredWithBackupKept(rejection: Error, backupPath: string): void {
  expect(rejection.message).toContain('restored to its previous state')
  // Task 13's acceptance criterion is that the error tells the user
  // *where* the backup is, not just that one exists somewhere.
  expect(rejection.message).toContain(backupPath)
  // doCloseVault(true) already ran as part of the double-failure fallback.
  expect(isVaultOpen()).toBe(false)
  // Rollback also failed — the backup must survive as the recovery copy.
  expect(existsSync(backupPath)).toBe(true)
}

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

    // The bug: packContainer() used to read only the main temp DB file,
    // never the -wal file, so this sync alone (no close) would produce a
    // container missing every note above.
    await syncContainer()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())

    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000) // real Argon2id calibration + KDF run on vault creation; observed ~25-35s

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

    // Characterization test, not a negative-control regression test:
    // verified by hand that this still passes even if closeVault() closes
    // `db` before calling packContainer() (packContainer()'s internal
    // checkpoint then silently no-ops on the null connection). SQLite
    // performs an implicit WAL checkpoint when the last connection to a
    // database closes, so closeDatabase() alone already flushes -wal into
    // the main file here. closeVault() still calls packContainer() before
    // closing — explicit over implicit, and it stops depending on that
    // SQLite behavior if a second connection is ever introduced — but
    // that ordering isn't what this test is proving.
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
    // closeVaultDrained() (#19) added several call sites that can now race a
    // caller who already closed the vault — e.g. the auto-lock timer firing
    // right as the user manually locks. doCloseVault() guards every step
    // (`if (db)`, `if (masterKey)`, ...), so a second call must be a safe
    // no-op, never a throw or a hang.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    await closeVault()
    expect(isVaultOpen()).toBe(false)

    await expect(closeVault()).resolves.toBeUndefined()
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
    // vault:save-copy-as calls packContainer() directly rather than
    // syncContainer(), specifically so a failed sync surfaces as a failed
    // backup instead of silently copying stale data. This proves the
    // rejection it depends on actually happens.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')
    await createNote(getDb(), { title: 'Note', content: 'Body' }, getMasterKey())

    rmSync(vaultDir, { recursive: true, force: true })

    await expect(packContainer()).rejects.toThrow()
  }, 60_000)

  it('serializes packContainer() against rotateVaultCredentials() so a repack can never race a rekey', async () => {
    // Characterization test, not a reliable negative control: verified by
    // hand that reverting withVaultLock to a passthrough does NOT
    // reliably fail this test. rotateVaultCredentials()'s deriveKey()
    // call is synchronous, CPU-bound Argon2id that blocks the single JS
    // thread for well over a second before its first await — packContainer()
    // (called on the next line, below) can't even start executing until
    // that blocking call returns, which narrows the real race window
    // unpredictably. A deterministic proof needs a controlled delay
    // (e.g. mocking the checkpoint's dbGet call) rather than real timing;
    // Task 6's withVaultLock unit tests above already prove the locking
    // mechanism itself serializes correctly and deterministically — this
    // test instead proves packContainer() and rotateVaultCredentials()
    // still behave correctly end-to-end when routed through it together.
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

    // The strongest proof against "bricked vault": actually unlock with
    // the new password. If the final .nvx header was built from a stale
    // key, the HMAC check inside openVault() fails and this returns null
    // rather than throwing — assert success, not just "didn't throw".
    const reopened = await openVault(vaultPath, newPassword)
    expect(reopened).not.toBeNull()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())
    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000)

  it("doesn't deadlock when rotateVaultCredentials()'s rollback also fails and falls back to closing the vault", async () => {
    // Forces the exact double-failure path found by /agent-skills:ship's
    // security-auditor: the primary rekey attempt succeeds, something
    // inside the transaction then fails, and the rollback rekey (back to
    // the old key) *also* fails — the catch block that used to call the
    // locked closeVault() from inside this already-locked function. Before
    // the doCloseVault() fix, this deadlocked the entire withVaultLock
    // queue permanently (verified by hand: reverting the catch blocks to
    // call closeVault() instead of doCloseVault() makes this test time out).
    //
    // Uses its own inline mock rather than triggerDoubleRollbackFailure()
    // below — this test needs the bounded-time Promise.race to distinguish
    // "rejected" from "hung" in 10s, instead of vitest's full test timeout.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    const liveDb = getDb()
    const originalRun = liveDb.run.bind(liveDb)
    let rekeyCalls = 0
    const runSpy = vi.spyOn(liveDb, 'run').mockImplementation((sql: string, ...rest: unknown[]) => {
      const callback = rest[rest.length - 1] as (err: Error | null) => void
      if (typeof sql === 'string' && sql === 'BEGIN TRANSACTION') {
        // Primary failure: something inside the rotation's transaction
        // fails, after the rekey to the new password already succeeded.
        callback(new Error('simulated transaction failure'))
        return liveDb
      }
      if (typeof sql === 'string' && sql.startsWith('PRAGMA rekey')) {
        rekeyCalls += 1
        if (rekeyCalls === 2) {
          // Secondary failure: the rollback rekey (back to the old
          // password) also fails.
          callback(new Error('simulated rollback rekey failure'))
          return liveDb
        }
      }
      return originalRun(sql, ...(rest as Parameters<typeof originalRun>[]))
    })

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
      // Issue #17 fix: the double-failure path now throws a new,
      // more actionable error (the original is chained via `cause`)
      // instead of the raw transaction error — see doChangePassword() etc.
      await expect(rotation).rejects.toThrow('restored to its previous state')
      await expect(rotation).rejects.toMatchObject({
        cause: expect.objectContaining({ message: 'simulated transaction failure' })
      })

      // The queue must still be usable afterward — proves doCloseVault()
      // actually ran to completion (including releasing the lock) rather
      // than leaving withVaultLock permanently wedged.
      const pingOrder: string[] = []
      await withVaultLock(async () => {
        pingOrder.push('ping')
      })
      expect(pingOrder).toEqual(['ping'])
    } finally {
      runSpy.mockRestore()
    }
  }, 30_000)

  // Characterization test, not a regression guard: verified by hand that
  // this passes unchanged against pre-Task-13 code too — the rollback-
  // succeeds path already deleted the backup and threw the original error
  // correctly before this fix. Issue #17's bug was specifically in the
  // double-failure path (the next test). Kept here to prove Task 13's
  // restructure didn't regress the already-working success path.
  it('rotateVaultCredentials(): deletes the backup and the vault reopens with the original password once the rollback rekey succeeds (issue #17)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'
    const backupPath = vaultPath + '.bak'

    await createVault(vaultPath, originalPassword)

    const NOTE_COUNT = 5
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }
    // Persist the notes to currentVaultPath before rotating, so the
    // backupPath copy taken at the start of the rotation actually contains
    // them — otherwise "restore the backup" would restore the vault's
    // original empty state, not a meaningful data-safety proof.
    await syncContainer()

    const liveDb = getDb()
    const originalRun = liveDb.run.bind(liveDb)
    // Only the primary transaction fails here — the rollback rekey (back
    // to the old password) runs for real and succeeds, unlike the
    // double-failure test above.
    const runSpy = vi.spyOn(liveDb, 'run').mockImplementation((sql: string, ...rest: unknown[]) => {
      const callback = rest[rest.length - 1] as (err: Error | null) => void
      if (typeof sql === 'string' && sql === 'BEGIN TRANSACTION') {
        callback(new Error('simulated transaction failure'))
        return liveDb
      }
      return originalRun(sql, ...(rest as Parameters<typeof originalRun>[]))
    })

    try {
      await expect(
        rotateVaultCredentials('a different correct horse battery staple')
      ).rejects.toThrow('simulated transaction failure')
    } finally {
      runSpy.mockRestore()
    }

    // Rollback succeeded — the backup is genuinely redundant and must be gone.
    expect(existsSync(backupPath)).toBe(false)

    await closeVault()
    const reopened = await openVault(vaultPath, originalPassword)
    expect(reopened).not.toBeNull()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())
    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000)

  it('rotateVaultCredentials(): keeps the backup and the vault still reopens with the original password when the rollback rekey also fails (issue #17)', async () => {
    // Before the issue #17 fix, this exact path deleted the backup
    // immediately after restoring it (before the rollback rekey was even
    // attempted) and then, post-Phase-6, ran doCloseVault()'s pack step
    // with mismatched key material — silently overwriting the just-restored
    // currentVaultPath with a container neither password could open, with
    // no backup left to recover from. Verified by hand: reverting Task 13
    // reproduces exactly that — openVault() below fails afterward.
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'
    const backupPath = vaultPath + '.bak'

    await createVault(vaultPath, originalPassword)

    const NOTE_COUNT = 5
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }
    // Persist the notes to currentVaultPath before rotating — see the
    // matching comment in the rollback-succeeds test above.
    await syncContainer()

    const rejection = await triggerDoubleRollbackFailure(() =>
      rotateVaultCredentials('a different correct horse battery staple')
    )

    expectRestoredWithBackupKept(rejection, backupPath)

    const reopened = await openVault(vaultPath, originalPassword)
    expect(reopened).not.toBeNull()
    // openVault()'s internal cleanupOrphanedTempFiles() call must not sweep
    // the .bak it just walked past — see the dedicated test below.
    expect(existsSync(backupPath)).toBe(true)

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())
    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000)

  it('openVault() leaves a leftover .bak in place while still cleaning up a leftover .tmp (issue #17)', async () => {
    // Simulates a fresh app start finding the leftovers of a previous,
    // interrupted double-failure rollback (see the test above). Before the
    // issue #17 fix, cleanupOrphanedTempFiles() swept .bak unconditionally
    // on every open — destroying the user's only recovery copy the moment
    // they reopened the app.
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

  // The 3 tests below extend Task 14's rollback-double-failure coverage
  // (previously scoped to rotateVaultCredentials() only — see plan.md's
  // documented scope decision) to the other 3 credential-rotation
  // functions, since they share the exact same catch-block restructure.
  // Each confirmed by hand to fail against pre-Task-13 vault.ts.

  it('changePassword(): keeps the backup and the vault still reopens with the original password when the rollback rekey also fails (issue #17)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'
    const backupPath = vaultPath + '.bak'

    await createVault(vaultPath, originalPassword)

    const NOTE_COUNT = 5
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }
    await syncContainer()

    const rejection = await triggerDoubleRollbackFailure(() =>
      changePassword(originalPassword, 'a different correct horse battery staple')
    )

    expectRestoredWithBackupKept(rejection, backupPath)

    const reopened = await openVault(vaultPath, originalPassword)
    expect(reopened).not.toBeNull()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())
    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000)

  it('configureKeyFile(): keeps the backup and the vault still reopens with the original password when the rollback rekey also fails (issue #17)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'
    const backupPath = vaultPath + '.bak'

    await createVault(vaultPath, originalPassword)

    const NOTE_COUNT = 5
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }
    await syncContainer()

    // The vault has no key file yet, so the restored backup — and thus the
    // reopen below — needs neither this key file nor any key file at all.
    const keyFileContents = randomBytes(32)
    const rejection = await triggerDoubleRollbackFailure(() =>
      configureKeyFile(originalPassword, keyFileContents)
    )

    expectRestoredWithBackupKept(rejection, backupPath)

    const reopened = await openVault(vaultPath, originalPassword)
    expect(reopened).not.toBeNull()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())
    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 60_000)

  it('removeKeyFile(): keeps the backup and the vault still reopens with the original password and key file when the rollback rekey also fails (issue #17)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'
    const backupPath = vaultPath + '.bak'

    await createVault(vaultPath, originalPassword)

    const NOTE_COUNT = 5
    const expectedTitles = new Map<string, string>()
    for (let i = 0; i < NOTE_COUNT; i++) {
      const title = `Note ${i}`
      const note = await createNote(getDb(), { title, content: `Body ${i}` }, getMasterKey())
      expectedTitles.set(note.id, title)
    }

    // removeKeyFile() requires a key file to already be configured — this
    // real call establishes that (and, as its own successful rotation,
    // persists the notes above to currentVaultPath in the process).
    const keyFileContents = randomBytes(32)
    await configureKeyFile(originalPassword, keyFileContents)

    const rejection = await triggerDoubleRollbackFailure(() =>
      removeKeyFile(originalPassword, keyFileContents)
    )

    expectRestoredWithBackupKept(rejection, backupPath)

    // The restored backup still has the key file configureKeyFile() just
    // set up — removeKeyFile() never got far enough to actually remove it.
    const reopened = await openVault(vaultPath, originalPassword, keyFileContents)
    expect(reopened).not.toBeNull()

    const persisted = await readNoteTitlesFromPackedContainer(vaultPath, getMasterKey())
    expect(persisted.size).toBe(NOTE_COUNT)
    for (const [id, title] of expectedTitles) {
      expect(persisted.get(id)).toBe(title)
    }
  }, 90_000)

  it('changePassword(): a second rotation in the same open session accepts the password the first rotation just set', async () => {
    // Found while extending issue #17's coverage to the other 3 credential-
    // rotation functions, not part of #17 itself: after any successful
    // rotation, currentMetadata was patched in place rather than re-derived
    // from the container bytes actually written, leaving
    // hmacCoveredBytes/storedHmac pointing at the PRE-rotation header. Any
    // later authenticateVaultKey() call in the same open session (the first
    // step of changePassword/configureKeyFile/removeKeyFile) then verified
    // the correct new password against that stale header and rejected it.
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
})

// Pure ordering test — no vault/crypto involved, deliberately fast and
// deterministic. Proving a race is closed needs controlled timing, which
// real Argon2id/SQLCipher calls can't reliably provide; the existing tests
// above already prove packContainer()/rotateVaultCredentials() etc. are
// individually correct.
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

  it('deadlocks permanently on a reentrant call — this is why closeVault()s catch-block fallbacks call doCloseVault() directly, never closeVault()', async () => {
    // withVaultLock is a plain FIFO queue, not a reentrant mutex: calling
    // it again from inside a function it's already running deadlocks that
    // call AND wedges the queue for every future caller (see #16 follow-up
    // — security-auditor found this via an identical isolated repro when
    // changePassword()'s double-rollback-failure catch block called the
    // locked closeVault() from inside doChangePassword(), itself already
    // running under withVaultLock). This test locks in that the primitive
    // itself is inherently non-reentrant, as a permanent guardrail against
    // ever "fixing" withVaultLock into something that silently tolerates
    // reentrancy instead of raising the alarm that a caller is misusing it.
    const reentrant = withVaultLock(async () => {
      await withVaultLock(async () => {})
    })

    const outcome = await Promise.race([
      reentrant.then(
        () => 'resolved' as const,
        () => 'rejected' as const
      ),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500))
    ])

    expect(outcome).toBe('timeout')
  })
})

// Structural test, not a behavioral one: tests/vault.test.ts cannot invoke
// ipc-handlers.ts's registered ipcMain.handle callbacks directly (no harness
// mocks electron/electron-updater in this repo), so a test that only calls
// getDb()/getMasterKey()/createNote() itself can never flip from red to green
// as a result of editing ipc-handlers.ts — the test itself would be the one
// deciding whether to wrap the call in withVaultLock, not the production
// code. Reading the real source file and asserting each handler's block
// contains a withVaultLock( call is the only way, without new IPC-mocking
// infrastructure, to tie this test's pass/fail state to the actual file
// issue #25's fix edits. See tasks/plan.md's "Nota de diseño" for the fuller
// rationale and the alternatives considered.
describe('ipc-handlers.ts: notes/tags handlers wrapped in withVaultLock (issue #25)', () => {
  // Every notes:*/tags:*/note-tags:* IPC channel registered in ipc-handlers.ts
  // as of this test's writing. Kept as an explicit list (not derived from the
  // source file itself) so a channel silently renamed or removed fails this
  // test with a clear "not found" message instead of quietly shrinking the
  // set of channels checked.
  const NOTE_AND_TAG_CHANNELS = [
    'notes:create',
    'notes:get',
    'notes:list',
    'notes:update',
    'notes:trash',
    'notes:restore',
    'notes:delete',
    'notes:empty-trash',
    'notes:search',
    'tags:create',
    'tags:create-and-assign',
    'tags:list',
    'tags:update',
    'tags:delete',
    'note-tags:add',
    'note-tags:remove',
    'note-tags:list',
    'note-tags:counts',
    'note-tags:all'
  ]

  it('each notes:*/tags:*/note-tags:* handler wraps its body in withVaultLock(...)', () => {
    const source = readFileSync(new URL('../src/main/ipc-handlers.ts', import.meta.url), 'utf-8')
    const handleCallStarts = [...source.matchAll(/ipcMain\.handle\(/g)].map((m) => m.index)

    for (const channel of NOTE_AND_TAG_CHANNELS) {
      const channelIdx = source.indexOf(`'${channel}'`)
      expect(channelIdx, `channel '${channel}' not found in ipc-handlers.ts`).toBeGreaterThan(-1)

      // The block for this channel runs from its own ipcMain.handle( call up
      // to the next one (or EOF for the last channel in the file) — no
      // paren-balancing needed, every handler's own ipcMain.handle( starts
      // strictly before its channel-name string literal.
      const blockStart = handleCallStarts.filter((i) => i <= channelIdx).pop()
      const blockEnd = handleCallStarts.find((i) => i > channelIdx) ?? source.length
      const block = source.slice(blockStart, blockEnd)

      expect(
        block.includes('withVaultLock('),
        `'${channel}' handler must read getDb()/getMasterKey() inside withVaultLock() — see issue #25`
      ).toBe(true)
    }
  })
})
