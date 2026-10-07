import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, describe, expect, it } from 'vitest'

import { dbGet, dbRun } from '../src/main/db/queries'

/**
 * Pins the ordering guarantee db.serialize() makes on one Database handle.
 * The app doesn't depend on the driver for write/checkpoint ordering — note
 * and tag handlers share withVaultLock() with packContainer() — and the
 * driver's implicit default mode (no serialize()) is not reliable under CPU
 * load on Linux, so the pair below is wrapped explicitly.
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
