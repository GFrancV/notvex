import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNote, getNote } from '@main/db/queries'
import {
  changePassword,
  closeVault,
  createVault,
  getDb,
  getMasterKey,
  withVaultLock
} from '@main/vault/vault'

// Characterization: reproduces with real data the race that makes note handlers need
// withVaultLock (a write landing mid-rotation), with deterministic timing.
describe('note write races a credential rotation (issue #25 — characterization)', () => {
  let vaultDir: string | undefined

  afterEach(async () => {
    try {
      await closeVault()
    } catch {
      /* ignore */
    }
    if (vaultDir) rmSync(vaultDir, { recursive: true, force: true })
    vaultDir = undefined
  })

  it('the racing note becomes undecryptable once changePassword() completes', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const oldPassword = 'correct horse battery staple'
    const newPassword = 'a different correct horse battery staple'

    await createVault(vaultPath, oldPassword)

    const liveDb = getDb()
    const originalRun = liveDb.run.bind(liveDb)

    let markWindowReached!: () => void
    const windowReached = new Promise<void>((resolve) => {
      markWindowReached = resolve
    })
    let releaseWindow!: () => void
    const windowGate = new Promise<void>((resolve) => {
      releaseWindow = resolve
    })

    // Held at wal_checkpoint(FULL): the rekey and reencryptNotes()'s COMMIT are done but masterKey
    // is still the old key, so a write here is too late to be re-encrypted and uses the stale key.
    const runSpy = vi.spyOn(liveDb, 'run').mockImplementation((sql: string, ...rest: unknown[]) => {
      if (typeof sql === 'string' && sql === 'PRAGMA wal_checkpoint(FULL)') {
        markWindowReached()
        void windowGate.then(() => {
          originalRun(sql, ...(rest as Parameters<typeof originalRun>))
        })
        return liveDb
      }
      return originalRun(sql, ...(rest as Parameters<typeof originalRun>))
    })

    try {
      const rotation = changePassword(oldPassword, newPassword)
      await windowReached

      // An unwrapped notes:create handler: reads getDb()/getMasterKey()
      // directly, with no withVaultLock around either call.
      const racingNote = await createNote(
        getDb(),
        { title: 'Racing note', content: 'Written mid-rotation' },
        getMasterKey()
      )

      releaseWindow()
      await rotation

      // masterKey is now the new key, but this note was encrypted under the old one after
      // reencryptNotes()'s SELECT, so it can't be decrypted.
      await expect(getNote(getDb(), racingNote.id, getMasterKey())).rejects.toThrow()
    } finally {
      runSpy.mockRestore()
    }
  }, 90_000)
})

// No rotation involved: two ordinary writes through the shared FIFO must both land, using the
// handlers' withVaultLock(() => op(getDb(), ..., getMasterKey())) shape.
describe('note/tag operations serialize with each other (issue #25 — concurrency)', () => {
  let vaultDir: string | undefined

  afterEach(async () => {
    try {
      await closeVault()
    } catch {
      /* ignore */
    }
    if (vaultDir) rmSync(vaultDir, { recursive: true, force: true })
    vaultDir = undefined
  })

  it('two concurrent note writes routed through withVaultLock run one at a time, not interleaved, and both land correctly', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    await createVault(vaultPath, 'correct horse battery staple')

    const order: string[] = []

    // Same shape as the notes:create handler.
    const writeNote = (title: string): Promise<{ id: string }> =>
      withVaultLock(async () => {
        order.push(`${title}-start`)
        const note = await createNote(getDb(), { title, content: 'Body' }, getMasterKey())
        order.push(`${title}-end`)
        return note
      })

    const [first, second] = await Promise.all([writeNote('First'), writeNote('Second')])

    // FIFO, not interleaved: the second call's closure can't start until the
    // first one's has fully settled.
    expect(order).toEqual(['First-start', 'First-end', 'Second-start', 'Second-end'])

    const firstPersisted = await getNote(getDb(), first.id, getMasterKey())
    const secondPersisted = await getNote(getDb(), second.id, getMasterKey())
    expect(firstPersisted?.title).toBe('First')
    expect(secondPersisted?.title).toBe('Second')
  }, 60_000)
})
