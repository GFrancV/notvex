import { randomBytes } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest'

import { createNote, dbAll, dbRun, getNote, listNotes, updateNote } from '../src/main/db/queries'
import { readContainer } from '../src/main/vault/container'
import {
  calibrateArgon2id,
  decryptField,
  deriveKey,
  getArgon2Params,
  memzero
} from '../src/main/vault/crypto'
import { allocSecure, freeSecure } from '../src/main/vault/memlock'
import {
  changePassword,
  closeVault,
  configureKeyFile,
  createVault,
  getDb,
  getMasterKey,
  isVaultOpen,
  openVault,
  openVaultWithRecovery,
  packContainer,
  removeKeyFile,
  rotateVaultCredentials,
  syncContainer,
  withVaultLock
} from '../src/main/vault/vault'

// Pass-through spies: tests capture the exact buffer a rotation derives and prove that
// instance is wiped, not merely that some memzero() ran.
vi.mock('../src/main/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/vault/crypto')>()
  return {
    ...actual,
    memzero: vi.fn(actual.memzero),
    deriveKey: vi.fn(actual.deriveKey),
    calibrateArgon2id: vi.fn(actual.calibrateArgon2id),
    getArgon2Params: vi.fn(actual.getArgon2Params)
  }
})

// Pass-through spies so a test can make one allocSecure()/freeSecure() throw. In a rotation
// those are storeKey(newRawKey) and the free of the old masterKey.
vi.mock('../src/main/vault/memlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/vault/memlock')>()
  return { allocSecure: vi.fn(actual.allocSecure), freeSecure: vi.fn(actual.freeSecure) }
})

interface RawNoteRow {
  id: string
  title: Buffer
  title_iv: Buffer
}

// Reads note titles straight from the packed .nvx on disk, independent of the live session
// (which would see notes that never reached the file).
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

const ORIGINAL_PASSWORD = 'correct horse battery staple'
const NEW_PASSWORD = 'a different correct horse battery staple'

// One entry per credential rotation. prepare() creates the vault (plus any precondition) and
// returns the rotation and how to reopen with the pre- and post-rotation credentials.
interface RotationCase {
  name: string
  // deriveKey() calls the rotation itself makes; the last one is newRawKey
  // (authenticateVaultKey() derives once first, except in rotateVaultCredentials).
  deriveKeyCalls: number
  prepare: (vaultPath: string) => Promise<{
    rotate: () => Promise<unknown>
    reopenWithOriginal: () => ReturnType<typeof openVault>
    reopenWithNew: () => ReturnType<typeof openVault>
  }>
}

const ROTATION_CASES: RotationCase[] = [
  {
    name: 'changePassword',
    deriveKeyCalls: 2,
    prepare: async (vaultPath) => {
      await createVault(vaultPath, ORIGINAL_PASSWORD)
      return {
        rotate: () => changePassword(ORIGINAL_PASSWORD, NEW_PASSWORD),
        reopenWithOriginal: () => openVault(vaultPath, ORIGINAL_PASSWORD),
        reopenWithNew: () => openVault(vaultPath, NEW_PASSWORD)
      }
    }
  },
  {
    name: 'rotateVaultCredentials',
    deriveKeyCalls: 1,
    prepare: async (vaultPath) => {
      await createVault(vaultPath, ORIGINAL_PASSWORD)
      return {
        rotate: () => rotateVaultCredentials(NEW_PASSWORD),
        reopenWithOriginal: () => openVault(vaultPath, ORIGINAL_PASSWORD),
        reopenWithNew: () => openVault(vaultPath, NEW_PASSWORD)
      }
    }
  },
  {
    name: 'configureKeyFile',
    deriveKeyCalls: 2,
    prepare: async (vaultPath) => {
      await createVault(vaultPath, ORIGINAL_PASSWORD)
      const keyFileContents = randomBytes(32)
      return {
        rotate: () => configureKeyFile(ORIGINAL_PASSWORD, keyFileContents),
        reopenWithOriginal: () => openVault(vaultPath, ORIGINAL_PASSWORD),
        reopenWithNew: () => openVault(vaultPath, ORIGINAL_PASSWORD, keyFileContents)
      }
    }
  },
  {
    name: 'removeKeyFile',
    deriveKeyCalls: 2,
    prepare: async (vaultPath) => {
      await createVault(vaultPath, ORIGINAL_PASSWORD)
      // removeKeyFile() requires a key file to already be configured.
      const keyFileContents = randomBytes(32)
      await configureKeyFile(ORIGINAL_PASSWORD, keyFileContents)
      return {
        rotate: () => removeKeyFile(ORIGINAL_PASSWORD, keyFileContents),
        reopenWithOriginal: () => openVault(vaultPath, ORIGINAL_PASSWORD, keyFileContents),
        reopenWithNew: () => openVault(vaultPath, ORIGINAL_PASSWORD)
      }
    }
  }
]

// Fails the next `times` liveDb.run() calls matching matchSql; all others pass through.
// The caller restores the spy.
function forceNextDbRunToFail(
  matchSql: (sql: string) => boolean,
  errorMessage: string,
  times = 1
): ReturnType<typeof vi.spyOn> {
  const liveDb = getDb()
  const originalRun = liveDb.run.bind(liveDb)
  let remaining = times
  return vi.spyOn(liveDb, 'run').mockImplementation((sql: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as (err: Error | null) => void
    if (typeof sql === 'string' && remaining > 0 && matchSql(sql)) {
      remaining -= 1
      callback(new Error(errorMessage))
      return liveDb
    }
    return originalRun(sql, ...(rest as Parameters<typeof originalRun>[]))
  })
}

// Asserts the `expectedDeriveCalls`-th deriveKey() result (newRawKey) is all zero and went
// through memzero() by reference. Coupling: newRawKey is picked by call ordinal, so a deriveKey()
// call added or reordered ahead of it makes this silently check authenticateVaultKey()'s
// buffer instead. Re-check the ordinals when those call sites change.
function expectNewRawKeyZeroed(
  deriveKeySpy: Mock<typeof deriveKey>,
  memzeroSpy: Mock<typeof memzero>,
  expectedDeriveCalls: number
): void {
  expect(deriveKeySpy).toHaveBeenCalledTimes(expectedDeriveCalls)
  const newRawKeyRef = deriveKeySpy.mock.results[expectedDeriveCalls - 1].value as Uint8Array
  expect(newRawKeyRef.length).toBeGreaterThan(0)
  expect(Array.from(newRawKeyRef).every((byte) => byte === 0)).toBe(true)
  expect(memzeroSpy.mock.calls.some(([buf]) => buf === newRawKeyRef)).toBe(true)
}

// Finds the two Buffer.from(newRawKey) copies (newHex source, writeContainer masterKey) by
// reference and asserts both are zeroed.
function expectNewRawKeyCopiesZeroed(
  bufferFromSpy: ReturnType<typeof vi.spyOn>,
  newRawKeyRef: Uint8Array
): void {
  const copies: Buffer[] = []
  bufferFromSpy.mock.calls.forEach((args: unknown[], i: number) => {
    if (args[0] === newRawKeyRef) copies.push(bufferFromSpy.mock.results[i].value as Buffer)
  })

  expect(copies).toHaveLength(2)
  for (const copy of copies) {
    expect(copy.length).toBeGreaterThan(0)
    expect(Array.from(copy).every((byte) => byte === 0)).toBe(true)
  }
}

// Success path: storeKey() and the outer finally both zero newRawKey; the second is a no-op.
function expectNewRawKeyZeroedTwice(
  memzeroSpy: Mock<typeof memzero>,
  newRawKeyRef: Uint8Array
): void {
  expect(memzeroSpy.mock.calls.filter(([buf]) => buf === newRawKeyRef)).toHaveLength(2)
  expect(Array.from(newRawKeyRef).every((byte) => byte === 0)).toBe(true)
}

// The verify derive's Buffer copy (candidateKey) must go through memzero(), not fill(0).
function expectVerifyKeyMemzeroed(
  bufferFromSpy: ReturnType<typeof vi.spyOn>,
  verifyDerivedRef: Uint8Array,
  memzeroSpy: Mock<typeof memzero>
): void {
  const idx = bufferFromSpy.mock.calls.findIndex((args: unknown[]) => args[0] === verifyDerivedRef)
  expect(idx).toBeGreaterThanOrEqual(0)
  const candidateKey = bufferFromSpy.mock.results[idx].value as Buffer
  expect(memzeroSpy.mock.calls.some(([buf]) => buf === candidateKey)).toBe(true)
  expect(Array.from(candidateKey).every((byte) => byte === 0)).toBe(true)
}

describe('packContainer WAL checkpoint (issue #16 regression)', () => {
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
    // ordering tests at the end of this file prove serialization deterministically.
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
      expectNewRawKeyCopiesZeroed(bufferFromSpy, newRawKeyRef)
      expectNewRawKeyZeroedTwice(memzeroSpy, newRawKeyRef)
    } finally {
      bufferFromSpy.mockRestore()
    }
  }, 90_000)

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
      expectNewRawKeyCopiesZeroed(bufferFromSpy, newRawKeyRef)
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
      expectNewRawKeyCopiesZeroed(bufferFromSpy, newRawKeyRef)
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
      expectNewRawKeyCopiesZeroed(bufferFromSpy, newRawKeyRef)
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

// Structural, not behavioral: there's no electron mocking here to invoke the real handlers, so
// this asserts on ipc-handlers.ts's source instead.
describe('ipc-handlers.ts: notes/tags handlers wrapped in withVaultLock (issue #25)', () => {
  // Explicit list, not derived from the source, so a renamed or removed channel fails loudly
  // instead of quietly shrinking the checked set.
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
    // Handlers register through the local handle() wrapper, one call per
    // line at registerIpcHandlers' indentation.
    const handleCallStarts = [...source.matchAll(/^ {2}handle\(/gm)].map((m) => m.index)
    expect(handleCallStarts.length).toBeGreaterThan(NOTE_AND_TAG_CHANNELS.length)

    for (const channel of NOTE_AND_TAG_CHANNELS) {
      const channelIdx = source.indexOf(`'${channel}'`)
      expect(channelIdx, `channel '${channel}' not found in ipc-handlers.ts`).toBeGreaterThan(-1)

      // A channel's block runs from its own handle( call to the next one (or EOF).
      const blockStart = handleCallStarts.filter((i) => i <= channelIdx).pop()
      const blockEnd = handleCallStarts.find((i) => i > channelIdx) ?? source.length
      const block = source.slice(blockStart, blockEnd)

      const lockIdx = block.indexOf('withVaultLock(')
      expect(
        lockIdx,
        `'${channel}' handler must call withVaultLock(...) — see issue #25`
      ).toBeGreaterThan(-1)

      // Every getDb()/getMasterKey() must come after withVaultLock(, i.e. inside its closure, not
      // merely somewhere in the block.
      for (const match of block.matchAll(/\b(?:getDb|getMasterKey)\(/g)) {
        expect(
          match.index,
          `'${channel}' handler must read getDb()/getMasterKey() inside withVaultLock() — see issue #25`
        ).toBeGreaterThan(lockIdx)
      }
    }
  })
})

// Characterization: reproduces with real data the race that makes note handlers need
// withVaultLock (a write landing mid-rotation), with deterministic timing.
describe('note write races a credential rotation (issue #25 — characterization)', () => {
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

  it('the racing note becomes undecryptable once changePassword() completes', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const oldPassword = 'correct horse battery staple'
    const newPassword = 'a different correct horse battery staple'

    await createVault(vaultPath, oldPassword)

    const liveDb = getDb()
    const originalRun = liveDb.run.bind(liveDb)

    let markWindowReached!: () => void
    const windowReached = new Promise<void>((resolve) => {
      markWindowReached = resolve
    })
    let releaseWindow!: () => void
    const windowGate = new Promise<void>((resolve) => {
      releaseWindow = resolve
    })

    // Held at wal_checkpoint(FULL): the rekey and reencryptNotes()'s COMMIT are done but masterKey
    // is still the old key, so a write here is too late to be re-encrypted and uses the stale key.
    const runSpy = vi.spyOn(liveDb, 'run').mockImplementation((sql: string, ...rest: unknown[]) => {
      if (typeof sql === 'string' && sql === 'PRAGMA wal_checkpoint(FULL)') {
        markWindowReached()
        void windowGate.then(() => {
          originalRun(sql, ...(rest as Parameters<typeof originalRun>))
        })
        return liveDb
      }
      return originalRun(sql, ...(rest as Parameters<typeof originalRun>))
    })

    try {
      const rotation = changePassword(oldPassword, newPassword)
      await windowReached

      // An unwrapped notes:create handler: reads getDb()/getMasterKey()
      // directly, with no withVaultLock around either call.
      const racingNote = await createNote(
        getDb(),
        { title: 'Racing note', content: 'Written mid-rotation' },
        getMasterKey()
      )

      releaseWindow()
      await rotation

      // masterKey is now the new key, but this note was encrypted under the old one after
      // reencryptNotes()'s SELECT, so it can't be decrypted.
      await expect(getNote(getDb(), racingNote.id, getMasterKey())).rejects.toThrow()
    } finally {
      runSpy.mockRestore()
    }
  }, 90_000)
})

// No rotation involved: two ordinary writes through the shared FIFO must both land, using the
// handlers' withVaultLock(() => op(getDb(), ..., getMasterKey())) shape.
describe('note/tag operations serialize with each other (issue #25 — concurrency)', () => {
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

  it('two concurrent note writes routed through withVaultLock run one at a time, not interleaved, and both land correctly', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    await createVault(vaultPath, 'correct horse battery staple')

    const order: string[] = []

    // Same shape as the notes:create handler.
    const writeNote = (title: string): Promise<{ id: string }> =>
      withVaultLock(async () => {
        order.push(`${title}-start`)
        const note = await createNote(getDb(), { title, content: 'Body' }, getMasterKey())
        order.push(`${title}-end`)
        return note
      })

    const [first, second] = await Promise.all([writeNote('First'), writeNote('Second')])

    // FIFO, not interleaved: the second call's closure can't start until the
    // first one's has fully settled.
    expect(order).toEqual(['First-start', 'First-end', 'Second-start', 'Second-end'])

    const firstPersisted = await getNote(getDb(), first.id, getMasterKey())
    const secondPersisted = await getNote(getDb(), second.id, getMasterKey())
    expect(firstPersisted?.title).toBe('First')
    expect(secondPersisted?.title).toBe('Second')
  }, 60_000)
})

describe('devBuild propagation (issue #34)', () => {
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

  it('createVault() defaults to devBuild: false when the argument is omitted', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(false)
  }, 90_000)

  it('createVault(devBuild: true) writes the flag, and a later rewrite (changePassword) preserves it', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword, true)
    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)

    await changePassword(originalPassword, 'a different correct horse battery staple')

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)
  }, 120_000)

  // rotateVaultCredentials/configureKeyFile/removeKeyFile each have their own writeContainer()
  // call, so each needs its own check that it still passes devBuild.

  it('rotateVaultCredentials() preserves an existing devBuild: true flag', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple', true)
    await rotateVaultCredentials('a different correct horse battery staple')

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)
  }, 120_000)

  it('configureKeyFile() preserves an existing devBuild: true flag', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const password = 'correct horse battery staple'

    await createVault(vaultPath, password, true)
    await configureKeyFile(password, randomBytes(32))

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)
  }, 120_000)

  it('removeKeyFile() preserves an existing devBuild: true flag', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const password = 'correct horse battery staple'
    const keyFileContents = randomBytes(32)

    await createVault(vaultPath, password, true)
    await configureKeyFile(password, keyFileContents)
    await removeKeyFile(password, keyFileContents)

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)
  }, 150_000)
})

// The editor's autosave ends with a queued notes:list resolving with an array; forwarded to
// doCloseVault it would land in skipPack. Calibration is stubbed to the cheapest tier.
describe('closeVault() packs regardless of the previous queued operation (issue #61)', () => {
  const PASSWORD = 'correct horse battery staple'
  let vaultDir: string
  let vaultPath: string

  beforeAll(async () => {
    vi.mocked(calibrateArgon2id).mockReturnValue({ tier: 10 })
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    vaultPath = join(vaultDir, 'test.nvx')
    await createVault(vaultPath, PASSWORD)
    await closeVault()
  }, 60_000)

  // A failed assertion would otherwise leave the vault open for the next case.
  afterEach(async () => {
    await closeVault()
  })

  afterAll(() => {
    vi.mocked(calibrateArgon2id).mockReset()
    rmSync(vaultDir, { recursive: true, force: true })
  })

  it('keeps an edit when the operation before the close resolved with a value (notes:list)', async () => {
    await openVault(vaultPath, PASSWORD)
    const note = await createNote(getDb(), { title: 'Draft', content: 'before' }, getMasterKey())
    await updateNote(getDb(), note.id, { content: 'after' }, getMasterKey())

    void withVaultLock(() => listNotes(getDb(), getMasterKey()))
    await closeVault()

    await openVault(vaultPath, PASSWORD)
    expect((await getNote(getDb(), note.id, getMasterKey()))?.content).toBe('after')
  }, 60_000)

  // Characterization: a rejected predecessor reaches fn as undefined
  // (vaultOpLock swallows it), which is the skipPack default. This guards
  // the rejection path.
  it('keeps an edit when the operation before the close rejected', async () => {
    await openVault(vaultPath, PASSWORD)
    const note = await createNote(getDb(), { title: 'Draft', content: 'before' }, getMasterKey())
    await updateNote(getDb(), note.id, { content: 'after' }, getMasterKey())

    withVaultLock(() => Promise.reject(new Error('boom'))).catch(() => undefined)
    await closeVault()

    await openVault(vaultPath, PASSWORD)
    expect((await getNote(getDb(), note.id, getMasterKey()))?.content).toBe('after')
  }, 60_000)

  it('reports a successful close as packFailed: false', async () => {
    await openVault(vaultPath, PASSWORD)

    await expect(closeVault()).resolves.toEqual({ packFailed: false })
  }, 60_000)

  it('reports a failed pack on close and logs only the error code, never the vault path', async () => {
    await openVault(vaultPath, PASSWORD)
    // atomicWrite() writes <vault>.tmp first; a directory there makes the pack fail
    // without touching the .nvx itself.
    const blocker = vaultPath + '.tmp'
    mkdirSync(blocker)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(closeVault()).resolves.toEqual({ packFailed: true })

      expect(log).toHaveBeenCalledExactlyOnceWith('[close] pack failed:', expect.any(String))
      for (const arg of log.mock.calls[0]) expect(String(arg)).not.toContain(vaultDir)
      expect(isVaultOpen()).toBe(false)
    } finally {
      log.mockRestore()
      rmSync(blocker, { recursive: true, force: true })
    }
  }, 60_000)

  it('leaves the last packed .nvx intact and reopenable after a failed pack', async () => {
    await openVault(vaultPath, PASSWORD)
    const note = await createNote(getDb(), { title: 'Draft', content: 'packed' }, getMasterKey())
    await closeVault()
    await openVault(vaultPath, PASSWORD)
    await updateNote(getDb(), note.id, { content: 'lost' }, getMasterKey())
    const blocker = vaultPath + '.tmp'
    mkdirSync(blocker)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(closeVault()).resolves.toEqual({ packFailed: true })
    } finally {
      log.mockRestore()
      rmSync(blocker, { recursive: true, force: true })
    }

    // Reopening also proves the lock was released on the failure path
    await openVault(vaultPath, PASSWORD)
    expect((await getNote(getDb(), note.id, getMasterKey()))?.content).toBe('packed')
  }, 60_000)

  // The catch block is the only thing between a failed pack and the key wipe
  // and lock release below it; logging must not be able to throw out of it.
  it('still closes, wipes and unlocks when the pack rejects with something that is not an Error', async () => {
    await openVault(vaultPath, PASSWORD)
    const notAnError: unknown = null
    vi.mocked(getArgon2Params).mockImplementationOnce(() => {
      throw notAnError
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(closeVault()).resolves.toEqual({ packFailed: true })
      expect(log).toHaveBeenCalledExactlyOnceWith('[close] pack failed:', 'object')
      expect(isVaultOpen()).toBe(false)
    } finally {
      log.mockRestore()
    }

    await expect(openVault(vaultPath, PASSWORD)).resolves.not.toBeNull()
  }, 60_000)
})

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
    const { withVaultLock: isolatedWithVaultLock } = await import('../src/main/vault/vault')

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
