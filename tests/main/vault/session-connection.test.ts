import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { dbGet } from '@main/db/queries'
import { closeVault, createVault, getDb } from '@main/vault/vault'

// The bundled build already defaults secure_delete on, so foreign_keys (off by default) is what
// shows whether the connection a session writes through got the vault's setup at all.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notvex-session-connection-'))
})

afterEach(async () => {
  await closeVault()
  rmSync(dir, { recursive: true, force: true })
})

describe('the connection a vault session writes through', () => {
  it('has the vault setup right after the vault is created', async () => {
    await createVault(join(dir, 'test.nvx'), 'correct horse battery staple', false, 10)

    const fk = await dbGet<{ foreign_keys: number }>(getDb(), 'PRAGMA foreign_keys')
    const sd = await dbGet<{ secure_delete: number }>(getDb(), 'PRAGMA secure_delete')
    expect({ foreignKeys: fk?.foreign_keys, secureDelete: sd?.secure_delete }).toEqual({
      foreignKeys: 1,
      secureDelete: 1
    })
  }, 60_000)
})
