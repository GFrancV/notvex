import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '@main/db/migrations'
import {
  addTagToNote,
  createNote,
  createTag,
  dbAll,
  dbGet,
  dbRun,
  duplicateNote,
  getNote,
  trashNote,
  updateNote
} from '@main/db/queries'
import { initSodium } from '@main/vault/crypto'

// A plain (unkeyed) database: the query layer is what's under test, not SQLCipher, and
// skipping the vault keeps Argon2id out of this suite.
const masterKey = new Uint8Array(32).fill(7)

let dir: string
let db: sqlite3.Database

interface CipherRow {
  title: Buffer
  title_iv: Buffer
  content: Buffer
  content_iv: Buffer
}

const cipherRow = (id: string): Promise<CipherRow | undefined> =>
  dbGet<CipherRow>(db, 'SELECT title, title_iv, content, content_iv FROM notes WHERE id = ?', [id])

describe('duplicateNote', () => {
  beforeAll(async () => {
    await initSodium()
  })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-duplicate-'))
    db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlcipher.Database(join(dir, 'dup.db'), (err) =>
        err ? reject(err) : resolve(database)
      )
    })
    await runMigrations(db)
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => db.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  async function sourceWithTags(): Promise<string> {
    const src = await createNote(db, { title: 'Plan', content: '# body\nline 2' }, masterKey)
    await updateNote(db, src.id, { isPinned: true }, masterKey)
    const a = await createTag(db, { name: 'work', color: 'blue' })
    const b = await createTag(db, { name: 'ideas', color: 'green' })
    await addTagToNote(db, src.id, a.id)
    await addTagToNote(db, src.id, b.id)
    return src.id
  }

  it('creates "<title> (copy)" with the same content and tags, unpinned, under a new id', async () => {
    const srcId = await sourceWithTags()
    const before = Date.now()

    const copy = await duplicateNote(db, srcId, masterKey)

    expect(copy.id).not.toBe(srcId)
    expect(copy.title).toBe('Plan (copy)')
    expect(copy.isPinned).toBe(false)
    expect(copy.isTrashed).toBe(false)
    expect(copy.createdAt).toBeGreaterThanOrEqual(before)
    expect(copy.updatedAt).toBe(copy.createdAt)
    expect(copy.tags.map((t) => t.name).sort()).toEqual(['ideas', 'work'])

    const stored = await getNote(db, copy.id, masterKey)
    expect(stored?.title).toBe('Plan (copy)')
    expect(stored?.content).toBe('# body\nline 2')
    expect(stored?.isPinned).toBe(false)
    expect(stored?.tags.map((t) => t.name).sort()).toEqual(['ideas', 'work'])
  })

  it('re-encrypts with fresh nonces, so no ciphertext or nonce matches the source', async () => {
    const srcId = await sourceWithTags()

    const copy = await duplicateNote(db, srcId, masterKey)

    const src = await cipherRow(srcId)
    const dup = await cipherRow(copy.id)
    expect(dup?.content_iv.equals(src!.content_iv)).toBe(false)
    expect(dup?.content.equals(src!.content)).toBe(false)
    expect(dup?.title_iv.equals(src!.title_iv)).toBe(false)
  })

  it('leaves the source note untouched', async () => {
    const srcId = await sourceWithTags()
    const before = await getNote(db, srcId, masterKey)

    await duplicateNote(db, srcId, masterKey)

    expect(await getNote(db, srcId, masterKey)).toEqual(before)
  })

  it('names the copy of an untitled note "Untitled (copy)"', async () => {
    const src = await createNote(db, { title: 'x', content: '' }, masterKey)
    await updateNote(db, src.id, { title: '' }, masterKey)

    const copy = await duplicateNote(db, src.id, masterKey)

    expect(copy.title).toBe('Untitled (copy)')
  })

  it('copies a tagless note without tag links', async () => {
    const src = await createNote(db, { title: 'Bare', content: 'body' }, masterKey)

    const copy = await duplicateNote(db, src.id, masterKey)

    expect(copy.tags).toEqual([])
    expect(await dbAll(db, 'SELECT tag_id FROM note_tags WHERE note_id = ?', [copy.id])).toEqual([])
  })

  it('rejects an unknown id without writing anything', async () => {
    await expect(duplicateNote(db, 'missing', masterKey)).rejects.toThrow('Note not found')
    expect(await dbAll(db, 'SELECT id FROM notes')).toHaveLength(0)
  })

  it('rejects a trashed note', async () => {
    const srcId = await sourceWithTags()
    await trashNote(db, srcId)

    await expect(duplicateNote(db, srcId, masterKey)).rejects.toThrow(
      'Cannot duplicate a trashed note'
    )
    expect(await dbAll(db, 'SELECT id FROM notes')).toHaveLength(1)
  })

  it('rolls back the new note when copying its tags fails', async () => {
    const srcId = await sourceWithTags()
    await dbRun(
      db,
      `CREATE TRIGGER fail_tag_copy BEFORE INSERT ON note_tags
       BEGIN SELECT RAISE(ABORT, 'boom'); END`
    )

    await expect(duplicateNote(db, srcId, masterKey)).rejects.toThrow('boom')

    expect(await dbAll(db, 'SELECT id FROM notes')).toEqual([{ id: srcId }])
  })
})
