import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '@main/db/migrations'
import { createNote, getNoteCounts, trashNote, updateNote } from '@main/db/queries'
import { initSodium } from '@main/vault/crypto'

// A plain (unkeyed) database: the query layer is what's under test, not SQLCipher.
const masterKey = new Uint8Array(32).fill(7)

let dir: string
let db: sqlite3.Database

async function note(opts: { pinned?: boolean; trashed?: boolean } = {}): Promise<void> {
  const { id } = await createNote(db, { title: 't', content: '' }, masterKey)
  if (opts.pinned) await updateNote(db, id, { isPinned: true }, masterKey)
  if (opts.trashed) await trashNote(db, id)
}

describe('getNoteCounts', () => {
  beforeAll(async () => {
    await initSodium()
  })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-counts-'))
    db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlcipher.Database(join(dir, 'counts.db'), (err) =>
        err ? reject(err) : resolve(database)
      )
    })
    await runMigrations(db)
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => db.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns zeros for an empty vault', async () => {
    expect(await getNoteCounts(db)).toEqual({ live: 0, pinned: 0, trashed: 0 })
  })

  it('counts live, pinned and trashed notes; a pinned note in the trash is only trashed', async () => {
    await note()
    await note({ pinned: true })
    await note({ trashed: true })
    await note({ pinned: true, trashed: true })

    expect(await getNoteCounts(db)).toEqual({ live: 2, pinned: 1, trashed: 2 })
  })
})
