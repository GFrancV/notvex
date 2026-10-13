import { randomBytes } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '@main/db/migrations'
import {
  createTag,
  dbAll,
  getNote,
  importNotes,
  listNotes,
  listTags,
  type ImportRead,
  type Note
} from '@main/db/queries'
import type { MarkdownNote } from '@main/markdown-io'
import { initSodium } from '@main/vault/crypto'
import { PRESET_COLORS } from '@shared/types'

const masterKey = new Uint8Array(randomBytes(32))

function fromMap(files: Record<string, MarkdownNote | string>) {
  return async (file: string): Promise<ImportRead> => {
    const entry = files[file]
    return typeof entry === 'string' ? { skip: entry } : { note: entry }
  }
}

describe('importNotes', () => {
  let dir: string
  let db: sqlite3.Database

  beforeAll(async () => {
    await initSodium()
  })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-import-'))
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

  async function noteByTitle(title: string): Promise<Note | null> {
    const items = await listNotes(db, masterKey, { trashed: false })
    const item = items.find((n) => n.title === title)
    return item ? getNote(db, item.id, masterKey) : null
  }

  it('creates one encrypted note per file with its tags', async () => {
    const result = await importNotes(
      db,
      ['/in/a.md', '/in/b.md'],
      masterKey,
      fromMap({
        '/in/a.md': { title: 'Alpha', content: 'first', tags: ['work', 'ideas'] },
        '/in/b.md': { title: 'Beta', content: 'second', tags: [] }
      })
    )

    expect(result).toEqual({ imported: 2, skipped: [], droppedTags: [] })
    const alpha = await noteByTitle('Alpha')
    expect(alpha?.content).toBe('first')
    expect(alpha?.tags.map((t) => t.name).sort()).toEqual(['ideas', 'work'])
    expect((await noteByTitle('Beta'))?.content).toBe('second')
  })

  it('reports skipped files by basename and imports the rest', async () => {
    const result = await importNotes(
      db,
      ['/secret/dir/big.md', '/in/ok.md'],
      masterKey,
      fromMap({
        '/secret/dir/big.md': 'too large',
        '/in/ok.md': { title: 'Ok', content: '', tags: [] }
      })
    )

    expect(result.imported).toBe(1)
    expect(result.skipped).toEqual([{ file: 'big.md', reason: 'too large' }])
  })

  it('reuses an existing tag whose name matches case-insensitively', async () => {
    const existing = await createTag(db, { name: 'Work', color: '#3b82f6' })

    await importNotes(
      db,
      ['/in/a.md'],
      masterKey,
      fromMap({ '/in/a.md': { title: 'A', content: '', tags: ['work', 'WORK'] } })
    )

    const tags = await listTags(db)
    expect(tags).toHaveLength(1)
    expect((await noteByTitle('A'))?.tags.map((t) => t.id)).toEqual([existing.id])
  })

  it('shares a tag created earlier in the same import', async () => {
    await importNotes(
      db,
      ['/in/a.md', '/in/b.md'],
      masterKey,
      fromMap({
        '/in/a.md': { title: 'A', content: '', tags: ['Shared'] },
        '/in/b.md': { title: 'B', content: '', tags: ['shared'] }
      })
    )

    const tags = await listTags(db)
    expect(tags.map((t) => t.name)).toEqual(['Shared'])
    expect(PRESET_COLORS).toContain(tags[0].color)
  })

  it('drops invalid tag names, keeps the note, and reports them', async () => {
    const tooLong = 'x'.repeat(25)
    const result = await importNotes(
      db,
      ['/in/a.md'],
      masterKey,
      fromMap({ '/in/a.md': { title: 'A', content: '', tags: ['  ', tooLong, ' ok '] } })
    )

    expect(result.imported).toBe(1)
    expect(result.droppedTags).toEqual([
      { file: 'a.md', count: 1, reason: 'longer than 24 characters' }
    ])
    expect((await noteByTitle('A'))?.tags.map((t) => t.name)).toEqual(['ok'])
  })

  it('keeps at most 50 tags on one note and reports the rest as one entry', async () => {
    const tags = Array.from({ length: 60 }, (_, i) => `t${i}`)
    const result = await importNotes(
      db,
      ['/in/a.md'],
      masterKey,
      fromMap({ '/in/a.md': { title: 'A', content: '', tags } })
    )

    expect((await noteByTitle('A'))?.tags).toHaveLength(50)
    expect(result.droppedTags).toEqual([
      { file: 'a.md', count: 10, reason: 'over the 50-tag limit for one note' }
    ])
  })

  it('creates at most 200 new tags per import but still reuses existing ones', async () => {
    await createTag(db, { name: 'existing', color: '#3b82f6' })
    const files: Record<string, MarkdownNote> = {}
    for (let f = 0; f < 5; f++) {
      const tags = Array.from({ length: 49 }, (_, i) => `f${f}-t${i}`)
      files[`/in/${f}.md`] = { title: `N${f}`, content: '', tags: [...tags, 'existing'] }
    }

    const result = await importNotes(db, Object.keys(files), masterKey, fromMap(files))

    expect(await listTags(db)).toHaveLength(201)
    expect((await noteByTitle('N4'))?.tags.map((t) => t.name)).toContain('existing')
    expect(result.droppedTags).toEqual([
      { file: '4.md', count: 45, reason: 'over the 200-new-tag limit for one import' }
    ])
  })

  it('rolls back every note and new tag when a later file fails', async () => {
    const files = {
      '/in/1.md': { title: 'One', content: '', tags: ['new-tag'] },
      '/in/2.md': { title: 'Two', content: '', tags: [] }
    }
    const read = async (file: string): Promise<ImportRead> => {
      if (file === '/in/3.md') throw new Error('disk gone')
      return { note: files[file as keyof typeof files] }
    }

    await expect(
      importNotes(db, ['/in/1.md', '/in/2.md', '/in/3.md'], masterKey, read)
    ).rejects.toThrow('disk gone')

    expect(await dbAll(db, 'SELECT id FROM notes')).toEqual([])
    expect(await dbAll(db, 'SELECT id FROM tags')).toEqual([])
    expect(await dbAll(db, 'SELECT note_id FROM note_tags')).toEqual([])
  })

  it('leaves the connection usable after a rollback', async () => {
    const failing = async (): Promise<ImportRead> => {
      throw new Error('boom')
    }
    await expect(importNotes(db, ['/in/x.md'], masterKey, failing)).rejects.toThrow('boom')

    const result = await importNotes(
      db,
      ['/in/y.md'],
      masterKey,
      fromMap({ '/in/y.md': { title: 'Y', content: '', tags: [] } })
    )
    expect(result.imported).toBe(1)
  })
})
