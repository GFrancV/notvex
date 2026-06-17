import type sqlite3 from '@journeyapps/sqlcipher'

import { decryptField, encryptField } from '../vault/crypto'

// ─── Promise wrappers ───────────────────────────────────────────────────────

export function dbRun(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => (err ? reject(err) : resolve()))
  })
}

export function dbGet<T>(
  db: sqlite3.Database,
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: T) => (err ? reject(err) : resolve(row)))
  })
}

export function dbAll<T>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows || [])))
  })
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface RawNote {
  id: string
  title: Buffer
  title_iv: Buffer
  content: Buffer
  content_iv: Buffer
  is_pinned: number
  is_trashed: number
  created_at: number
  updated_at: number
  trashed_at: number | null
}

interface RawNoteListItem {
  id: string
  title: Buffer
  title_iv: Buffer
  is_pinned: number
  is_trashed: number
  created_at: number
  updated_at: number
  trashed_at: number | null
}

export interface Note {
  id: string
  title: string
  content: string
  isPinned: boolean
  isTrashed: boolean
  createdAt: number
  updatedAt: number
  trashedAt: number | null
  tags: Tag[]
}

export interface NoteListItem {
  id: string
  title: string
  isPinned: boolean
  isTrashed: boolean
  createdAt: number
  updatedAt: number
  trashedAt: number | null
  tags: Tag[]
}

export interface Tag {
  id: string
  name: string
  color: string
  createdAt: number
}

export interface CreateNoteInput {
  title: string
  content: string
}

export interface NotePatch {
  title?: string
  content?: string
  isPinned?: boolean
}

export interface NoteFilter {
  trashed?: boolean
  tagId?: string
}

export interface CreateTagInput {
  name: string
  color: string
}

export interface TagPatch {
  name?: string
  color?: string
}

// ─── Note queries ────────────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID()
}

export async function createNote(
  db: sqlite3.Database,
  input: CreateNoteInput,
  masterKey: Uint8Array
): Promise<NoteListItem> {
  const id = newId()
  const now = Date.now()
  const { ciphertext: titleCipher, nonce: titleIv } = encryptField(
    input.title || 'Untitled',
    masterKey
  )
  const { ciphertext: contentCipher, nonce: contentIv } = encryptField(
    input.content || '',
    masterKey
  )

  await dbRun(
    db,
    `INSERT INTO notes
      (id, title, title_iv, content, content_iv, is_pinned, is_trashed, created_at, updated_at, trashed_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, NULL)`,
    [
      id,
      Buffer.from(titleCipher),
      Buffer.from(titleIv),
      Buffer.from(contentCipher),
      Buffer.from(contentIv),
      now,
      now
    ]
  )

  return {
    id,
    title: input.title || 'Untitled',
    isPinned: false,
    isTrashed: false,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    tags: []
  }
}

export async function getNote(
  db: sqlite3.Database,
  id: string,
  masterKey: Uint8Array
): Promise<Note | null> {
  const row = await dbGet<RawNote>(db, 'SELECT * FROM notes WHERE id = ?', [id])
  if (!row) return null

  const tags = await getNoteTags(db, id)
  return {
    id: row.id,
    title: decryptField(new Uint8Array(row.title), new Uint8Array(row.title_iv), masterKey),
    content: decryptField(new Uint8Array(row.content), new Uint8Array(row.content_iv), masterKey),
    isPinned: row.is_pinned === 1,
    isTrashed: row.is_trashed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
    tags
  }
}

export async function listNotes(
  db: sqlite3.Database,
  masterKey: Uint8Array,
  filter: NoteFilter = {}
): Promise<NoteListItem[]> {
  let sql: string
  let params: unknown[]

  if (filter.tagId) {
    sql = `SELECT n.id, n.title, n.title_iv, n.is_pinned, n.is_trashed, n.created_at, n.updated_at, n.trashed_at
           FROM notes n JOIN note_tags nt ON n.id = nt.note_id
           WHERE nt.tag_id = ? AND n.is_trashed = ?
           ORDER BY n.is_pinned DESC, n.updated_at DESC`
    params = [filter.tagId, filter.trashed ? 1 : 0]
  } else {
    sql = `SELECT id, title, title_iv, is_pinned, is_trashed, created_at, updated_at, trashed_at
           FROM notes WHERE is_trashed = ?
           ORDER BY is_pinned DESC, updated_at DESC`
    params = [filter.trashed ? 1 : 0]
  }

  const rows = await dbAll<RawNoteListItem>(db, sql, params)
  if (rows.length === 0) return []

  const noteIds = rows.map((r) => r.id)
  const placeholders = noteIds.map(() => '?').join(', ')
  const [noteTags, allTags] = await Promise.all([
    dbAll<{ noteId: string; tagId: string }>(
      db,
      `SELECT note_id as noteId, tag_id as tagId FROM note_tags WHERE note_id IN (${placeholders})`,
      noteIds
    ),
    dbAll<Tag>(db, 'SELECT id, name, color, created_at as createdAt FROM tags')
  ])

  const tagById = new Map(allTags.map((t) => [t.id, t]))
  const tagsByNote = new Map<string, Tag[]>()
  for (const { noteId, tagId } of noteTags) {
    const tag = tagById.get(tagId)
    if (!tag) continue
    const arr = tagsByNote.get(noteId) ?? []
    arr.push(tag)
    tagsByNote.set(noteId, arr)
  }

  return rows.map((row) => ({
    id: row.id,
    title: decryptField(new Uint8Array(row.title), new Uint8Array(row.title_iv), masterKey),
    isPinned: row.is_pinned === 1,
    isTrashed: row.is_trashed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
    tags: tagsByNote.get(row.id) ?? []
  }))
}

export async function updateNote(
  db: sqlite3.Database,
  id: string,
  patch: NotePatch,
  masterKey: Uint8Array
): Promise<void> {
  const now = Date.now()
  const updates: string[] = ['updated_at = ?']
  const params: unknown[] = [now]

  if (patch.title !== undefined) {
    const { ciphertext, nonce } = encryptField(patch.title, masterKey)
    updates.push('title = ?', 'title_iv = ?')
    params.push(Buffer.from(ciphertext), Buffer.from(nonce))
  }

  if (patch.content !== undefined) {
    const { ciphertext, nonce } = encryptField(patch.content, masterKey)
    updates.push('content = ?', 'content_iv = ?')
    params.push(Buffer.from(ciphertext), Buffer.from(nonce))
  }

  if (patch.isPinned !== undefined) {
    updates.push('is_pinned = ?')
    params.push(patch.isPinned ? 1 : 0)
  }

  params.push(id)
  await dbRun(db, `UPDATE notes SET ${updates.join(', ')} WHERE id = ?`, params)
}

export async function trashNote(db: sqlite3.Database, id: string): Promise<void> {
  await dbRun(db, 'UPDATE notes SET is_trashed = 1, trashed_at = ? WHERE id = ?', [Date.now(), id])
}

export async function restoreNote(db: sqlite3.Database, id: string): Promise<void> {
  await dbRun(db, 'UPDATE notes SET is_trashed = 0, trashed_at = NULL WHERE id = ?', [id])
}

export async function deleteNote(db: sqlite3.Database, id: string): Promise<void> {
  await dbRun(db, 'DELETE FROM notes WHERE id = ?', [id])
}

export async function emptyTrash(db: sqlite3.Database): Promise<void> {
  await dbRun(db, 'DELETE FROM notes WHERE is_trashed = 1')
}

export async function searchNotesByTitle(
  db: sqlite3.Database,
  query: string,
  masterKey: Uint8Array
): Promise<NoteListItem[]> {
  const all = await listNotes(db, masterKey, { trashed: false })
  const lower = query.toLowerCase()
  return all.filter((n) => n.title.toLowerCase().includes(lower))
}

// ─── Tag queries ─────────────────────────────────────────────────────────────
// Tag names are intentionally not application-layer encrypted. See migrations.ts migration_v1.

export async function createTag(db: sqlite3.Database, input: CreateTagInput): Promise<Tag> {
  const id = newId()
  const now = Date.now()
  await dbRun(db, 'INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)', [
    id,
    input.name,
    input.color,
    now
  ])
  return { id, name: input.name, color: input.color, createdAt: now }
}

export async function listTags(db: sqlite3.Database): Promise<Tag[]> {
  return dbAll<Tag>(db, 'SELECT id, name, color, created_at as createdAt FROM tags ORDER BY name')
}

export async function updateTag(db: sqlite3.Database, id: string, patch: TagPatch): Promise<void> {
  const updates: string[] = []
  const params: unknown[] = []

  if (patch.name !== undefined) {
    updates.push('name = ?')
    params.push(patch.name)
  }
  if (patch.color !== undefined) {
    updates.push('color = ?')
    params.push(patch.color)
  }

  if (updates.length === 0) return
  params.push(id)
  await dbRun(db, `UPDATE tags SET ${updates.join(', ')} WHERE id = ?`, params)
}

export async function deleteTag(db: sqlite3.Database, id: string): Promise<void> {
  await dbRun(db, 'DELETE FROM tags WHERE id = ?', [id])
}

// ─── Note-tag junction ────────────────────────────────────────────────────────

export async function addTagToNote(
  db: sqlite3.Database,
  noteId: string,
  tagId: string
): Promise<void> {
  await dbRun(db, 'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', [
    noteId,
    tagId
  ])
}

export async function removeTagFromNote(
  db: sqlite3.Database,
  noteId: string,
  tagId: string
): Promise<void> {
  await dbRun(db, 'DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?', [noteId, tagId])
}

export async function getNoteTags(db: sqlite3.Database, noteId: string): Promise<Tag[]> {
  return dbAll<Tag>(
    db,
    `SELECT t.id, t.name, t.color, t.created_at as createdAt
     FROM tags t JOIN note_tags nt ON t.id = nt.tag_id
     WHERE nt.note_id = ?`,
    [noteId]
  )
}

export async function getNoteCountPerTag(db: sqlite3.Database): Promise<Record<string, number>> {
  const rows = await dbAll<{ tag_id: string; count: number }>(
    db,
    `SELECT nt.tag_id, COUNT(*) as count FROM note_tags nt
     JOIN notes n ON n.id = nt.note_id
     WHERE n.is_trashed = 0 GROUP BY nt.tag_id`
  )
  return Object.fromEntries(rows.map((r) => [r.tag_id, r.count]))
}

export async function getAllNoteTags(
  db: sqlite3.Database
): Promise<Array<{ noteId: string; tagId: string }>> {
  return dbAll<{ noteId: string; tagId: string }>(
    db,
    `SELECT note_id as noteId, tag_id as tagId FROM note_tags
     WHERE note_id IN (SELECT id FROM notes WHERE is_trashed = 0)`
  )
}
