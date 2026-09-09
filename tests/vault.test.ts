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
import { closeVault, createVault, getDb, getMasterKey, syncContainer } from '../src/main/vault/vault'

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
})
