import { randomBytes } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, describe, expect, it } from 'vitest'

import { createNote, dbAll } from '../src/main/db/queries'
import { readContainer } from '../src/main/vault/container'
import { decryptField } from '../src/main/vault/crypto'
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
})
