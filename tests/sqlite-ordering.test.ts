import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, describe, expect, it } from 'vitest'

import { dbGet, dbRun } from '../src/main/db/queries'

/**
 * doPackContainer() issues a WAL checkpoint moments after a note write, with
 * no app-level lock between them (packContainer only serializes against
 * itself and credential rotation via withVaultLock, not against notes:update
 * — see vault.ts). That's only safe because the sqlite3 driver runs commands
 * against one Database handle in strict issue order. Nothing in the app
 * enforces that guarantee; this pins it against the real driver so a future
 * dependency bump can't silently break it (security review finding).
 */
describe('sqlite3 driver ordering', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('runs queued commands against one Database handle in issue order, never interleaved', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-sqlite-order-'))
    const dbPath = join(dir, 'order.db')

    const db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlcipher.Database(dbPath, (err) =>
        err ? reject(err) : resolve(database)
      )
    })

    await dbRun(db, 'CREATE TABLE t (id INTEGER)')

    // No await between these two — the write is only *issued*, not settled,
    // before the read right after it. If the driver ever interleaved
    // commands on the same handle, the read could see the table before the
    // row actually lands in it.
    const write = dbRun(db, 'INSERT INTO t (id) VALUES (1)')
    const read = dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM t')

    await write
    expect((await read)?.count).toBe(1)

    await new Promise<void>((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())))
  })
})
