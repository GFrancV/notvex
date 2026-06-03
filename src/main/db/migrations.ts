import type sqlite3 from '@journeyapps/sqlcipher'
import { dbRun } from './queries'

export async function runMigrations(db: sqlite3.Database): Promise<void> {
  await dbRun(db, 'PRAGMA journal_mode=WAL')
  await dbRun(db, 'PRAGMA foreign_keys=ON')

  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS vault_meta (
      id                    INTEGER PRIMARY KEY CHECK (id = 1),
      version               INTEGER NOT NULL DEFAULT 1,
      argon2_salt           BLOB    NOT NULL,
      argon2_params         TEXT    NOT NULL,
      verify_hash           TEXT    NOT NULL,
      recovery_verify_hash  TEXT    NOT NULL,
      created_at            INTEGER NOT NULL
    )
  `)

  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS notes (
      id          TEXT    PRIMARY KEY,
      title       BLOB    NOT NULL,
      title_iv    BLOB    NOT NULL,
      content     BLOB    NOT NULL,
      content_iv  BLOB    NOT NULL,
      is_pinned   INTEGER NOT NULL DEFAULT 0,
      is_trashed  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      trashed_at  INTEGER
    )
  `)

  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS tags (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL UNIQUE,
      color      TEXT    NOT NULL DEFAULT '#6366f1',
      created_at INTEGER NOT NULL
    )
  `)

  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    )
  `)

  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_notes_updated  ON notes(updated_at DESC)')
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_notes_trashed  ON notes(is_trashed)')
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id)')
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_note_tags_tag  ON note_tags(tag_id)')
}
