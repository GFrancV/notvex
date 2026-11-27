import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '@main/db/migrations'
import { dbGet, dbRun } from '@main/db/queries'

// Deleted notes must not survive in the vault file whatever SQLCipher build is bundled, so each
// connection starts with secure delete off, as a build without SQLITE_SECURE_DELETE would have
// it. Unkeyed on purpose: with encryption on, the file bytes can't show whether the deleted
// content is still there.
const MARKER = 'notvex-secure-delete-marker'

let dir: string
let dbPath: string
let db: InstanceType<typeof sqlcipher.Database>

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'notvex-secure-delete-'))
  dbPath = join(dir, 'test.db')
  db = new sqlcipher.Database(dbPath)
  await dbRun(db, 'PRAGMA secure_delete=OFF')
})

afterEach(async () => {
  await new Promise<void>((resolve) => db.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

describe('secure delete', () => {
  it('turns secure delete on when a vault connection is set up, even if the build leaves it off', async () => {
    await runMigrations(db)

    const row = await dbGet<{ secure_delete: number }>(db, 'PRAGMA secure_delete')
    expect(row?.secure_delete).toBe(1)
  })

  it('leaves no trace of deleted content in the database file', async () => {
    await runMigrations(db)
    await dbRun(db, 'CREATE TABLE t (x TEXT)')
    await dbRun(db, 'INSERT INTO t VALUES (?)', [MARKER.repeat(200)])
    await dbGet(db, 'PRAGMA wal_checkpoint(TRUNCATE)')
    expect(readFileSync(dbPath).includes(MARKER)).toBe(true)

    await dbRun(db, 'DELETE FROM t')
    await dbGet(db, 'PRAGMA wal_checkpoint(TRUNCATE)')
    expect(readFileSync(dbPath).includes(MARKER)).toBe(false)
  })

  it('leaves no trace of the previous version of edited content', async () => {
    await runMigrations(db)
    await dbRun(db, 'CREATE TABLE t (x TEXT)')
    await dbRun(db, 'INSERT INTO t VALUES (?)', [MARKER.repeat(200)])
    await dbGet(db, 'PRAGMA wal_checkpoint(TRUNCATE)')
    expect(readFileSync(dbPath).includes(MARKER)).toBe(true)

    await dbRun(db, 'UPDATE t SET x = ?', ['edited'])
    await dbGet(db, 'PRAGMA wal_checkpoint(TRUNCATE)')
    expect(readFileSync(dbPath).includes(MARKER)).toBe(false)
  })
})
