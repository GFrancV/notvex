import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, describe, expect, it } from 'vitest'

import { dbGet, dbRun } from '../src/main/db/queries'

/**
 * Pins db.serialize()'s same-handle ordering. The app doesn't rely on it for write/checkpoint
 * ordering (withVaultLock does), and the driver's default mode is unreliable under load, so
 * the pair below is wrapped explicitly.
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

    // Both calls are queued inside serialize() before either settles; interleaving would let the
    // read run before the row lands.
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
