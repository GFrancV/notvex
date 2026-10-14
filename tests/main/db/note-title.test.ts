import { randomBytes } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '@main/db/migrations'
import { createNote, getNoteTitle } from '@main/db/queries'
import { initSodium } from '@main/vault/crypto'

const masterKey = new Uint8Array(randomBytes(32))

describe('getNoteTitle', () => {
  let dir: string
  let db: sqlite3.Database

  beforeAll(async () => {
    await initSodium()
  })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-title-'))
    db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlcipher.Database(join(dir, 'vault.db'), (err) =>
        err ? reject(err) : resolve(database)
      )
    })
    await runMigrations(db)
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => db.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  it('decrypts the title of a note', async () => {
    const note = await createNote(db, { title: 'Plan: Q3', content: 'secret' }, masterKey)

    expect(await getNoteTitle(db, note.id, masterKey)).toBe('Plan: Q3')
  })

  it('returns null for an id that does not exist', async () => {
    expect(await getNoteTitle(db, 'missing', masterKey)).toBeNull()
  })
})
