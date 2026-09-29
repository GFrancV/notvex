import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, describe, expect, it } from 'vitest'

import { dbGet, dbRun } from '../src/main/db/queries'

/**
 * Historical note: this test originally pinned the sqlite3 driver's
 * *implicit default* queuing mode (no explicit db.serialize() call),
 * because doPackContainer()'s WAL checkpoint used to run shortly after a
 * note write with no app-level lock between them. Since issue #25, every
 * notes: and tags: IPC handler is routed through the same withVaultLock()
 * queue packContainer() uses (see ipc-handlers.ts, vault.ts), so that
 * ordering is now guaranteed at the app level regardless of what the
 * driver does internally — this test is no longer production-load-bearing
 * in the way it originally was.
 *
 * It failed intermittently in CI (issue #43): reproduced on native Linux
 * under artificial CPU load (1/20 runs), never on Windows under equivalent
 * load. Wrapping the same write/read pair in an explicit db.serialize()
 * block instead of relying on the implicit default mode closed it
 * (100/100 passes under the same load that produced the 1/20 failure
 * without it) — so this now pins the guarantee db.serialize() itself
 * makes, which is the one still worth having a regression test for.
 */
describe('sqlite3 driver ordering', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('db.serialize() runs queued commands against one Database handle in issue order, never interleaved', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-sqlite-order-'))
    const dbPath = join(dir, 'order.db')

    const db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlcipher.Database(dbPath, (err) =>
        err ? reject(err) : resolve(database)
      )
    })

    await dbRun(db, 'CREATE TABLE t (id INTEGER)')

    // No await between these two — the write is only *issued*, not settled,
    // before the read right after it. db.serialize()'s callback runs
    // synchronously, so both calls are queued before either settles; if
    // db.serialize() ever interleaved commands on the same handle, the read
    // could see the table before the row actually lands in it.
    let write!: Promise<void>
    let read!: Promise<{ count: number } | undefined>
    db.serialize(() => {
      write = dbRun(db, 'INSERT INTO t (id) VALUES (1)')
      read = dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM t')
    })

    await write
    expect((await read)?.count).toBe(1)

    await new Promise<void>((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())))
  })
})
