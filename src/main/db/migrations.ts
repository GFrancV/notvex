import type sqlite3 from '@journeyapps/sqlcipher'

import { dbGet, dbRun } from './queries'

interface MigrationStep {
  version: number
  run: (db: sqlite3.Database) => Promise<void>
}

const MIGRATIONS: MigrationStep[] = [{ version: 1, run: migration_v1 }]
// Future: append { version: 2, run: migration_v2 }

export const MAX_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export interface SchemaMigrationRequest {
  fromVersion: number
  toVersion: number
}
export type SchemaMigrationGate = (request: SchemaMigrationRequest) => Promise<boolean>

export async function runMigrations(
  db: sqlite3.Database,
  onMigrationNeeded?: SchemaMigrationGate
): Promise<void> {
  // PRAGMAs that affect the whole connection must run outside any transaction.
  await dbRun(db, 'PRAGMA journal_mode=WAL')
  await dbRun(db, 'PRAGMA foreign_keys=ON')

  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`
  )

  const row = await dbGet<{ version: number }>(
    db,
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
  )
  const currentVersion = row?.version ?? 0

  if (currentVersion > MAX_SCHEMA_VERSION) {
    throw new Error('SCHEMA_VERSION_TOO_NEW')
  }

  // Only a brand-new DB is at 0 (createVault passes no gate), so 0 never prompts.
  if (currentVersion > 0 && currentVersion < MAX_SCHEMA_VERSION) {
    if (!onMigrationNeeded) throw new Error('SCHEMA_MIGRATION_CONFIRMATION_REQUIRED')
    const proceed = await onMigrationNeeded({
      fromVersion: currentVersion,
      toVersion: MAX_SCHEMA_VERSION
    })
    if (!proceed) throw new Error('SCHEMA_MIGRATION_CANCELLED')
  }

  for (const step of MIGRATIONS) {
    if (step.version > currentVersion) await applyMigration(db, step.version, step.run)
  }
}

async function applyMigration(
  db: sqlite3.Database,
  version: number,
  fn: (db: sqlite3.Database) => Promise<void>
): Promise<void> {
  await dbRun(db, 'BEGIN TRANSACTION')
  try {
    await fn(db)
    await dbRun(db, 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
      version,
      Date.now()
    ])
    await dbRun(db, 'COMMIT')
  } catch (err) {
    await dbRun(db, 'ROLLBACK').catch(() => {})
    throw err
  }
}

async function migration_v1(db: sqlite3.Database): Promise<void> {
  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS vault_meta (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      version       INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      has_key_file  INTEGER NOT NULL DEFAULT 0
    )`
    // No key-verification column: a stored hash of the key would allow offline brute force. A
    // wrong key fails SQLCipher's first read instead (authenticateVaultKey()).
  )

  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS notes (
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
    )`
  )

  // Tag names are plaintext inside SQLCipher (no app-layer encryption) so SQL can query them;
  // they rely on page-level AES alone. Accepted tradeoff.
  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS tags (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL UNIQUE,
      color      TEXT    NOT NULL DEFAULT '#6366f1',
      created_at INTEGER NOT NULL
    )`
  )

  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    )`
  )

  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_notes_updated  ON notes(updated_at DESC)')
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_notes_trashed  ON notes(is_trashed)')
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id)')
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_note_tags_tag  ON note_tags(tag_id)')
}
