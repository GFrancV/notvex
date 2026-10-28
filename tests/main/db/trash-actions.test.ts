import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '@main/db/migrations'
import { createNote, deleteNote, getNoteCounts, restoreNote, trashNote } from '@main/db/queries'
import { initSodium } from '@main/vault/crypto'

// A plain (unkeyed) database: the query layer is what's under test, not SQLCipher.
const masterKey = new Uint8Array(32).fill(7)

let dir: string
let db: sqlite3.Database

describe('restore and permanent delete', () => {
  beforeAll(async () => {
    await initSodium()
  })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-trash-'))
    db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlcipher.Database(join(dir, 'trash.db'), (err) =>
        err ? reject(err) : resolve(database)
      )
    })
    await runMigrations(db)
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => db.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  it('deletes a trashed note for good', async () => {
    const { id } = await createNote(db, { title: 't', content: '' }, masterKey)
    await trashNote(db, id)

    await deleteNote(db, id)

    expect(await getNoteCounts(db)).toEqual({ live: 0, pinned: 0, trashed: 0 })
  })

  // The list can still show a live note under the Trash view's menu while it reloads.
  it('refuses a note outside the trash and keeps it', async () => {
    const { id } = await createNote(db, { title: 't', content: '' }, masterKey)

    await expect(deleteNote(db, id)).rejects.toThrow("isn't in the trash")

    expect(await getNoteCounts(db)).toEqual({ live: 1, pinned: 0, trashed: 0 })
  })

  it('restores a trashed note', async () => {
    const { id } = await createNote(db, { title: 't', content: '' }, masterKey)
    await trashNote(db, id)

    await restoreNote(db, id)

    expect(await getNoteCounts(db)).toEqual({ live: 1, pinned: 0, trashed: 0 })
  })

  // Undo can outlive the note: the trash may be emptied while its toast is still up.
  it('refuses to restore a note that is no longer in the trash', async () => {
    const { id } = await createNote(db, { title: 't', content: '' }, masterKey)
    await trashNote(db, id)
    await deleteNote(db, id)

    await expect(restoreNote(db, id)).rejects.toThrow("isn't in the trash")
  })
})
