import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createNote, getNote, listNotes, updateNote } from '@main/db/queries'
import { calibrateArgon2id, getArgon2Params } from '@main/vault/crypto'
import {
  closeVault,
  createVault,
  getDb,
  getMasterKey,
  isVaultOpen,
  openVault,
  withVaultLock
} from '@main/vault/vault'

// Pass-through spies so calibration and the Argon2 params can be stubbed.
vi.mock('@main/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/crypto')>()
  return {
    ...actual,
    calibrateArgon2id: vi.fn(actual.calibrateArgon2id),
    getArgon2Params: vi.fn(actual.getArgon2Params)
  }
})

// The editor's autosave ends with a queued notes:list resolving with an array; forwarded to
// doCloseVault it would land in skipPack. Calibration is stubbed to the cheapest tier.
describe('closeVault() packs regardless of the previous queued operation (issue #61)', () => {
  const PASSWORD = 'correct horse battery staple'
  let vaultDir: string
  let vaultPath: string

  beforeAll(async () => {
    vi.mocked(calibrateArgon2id).mockReturnValue({ tier: 10 })
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    vaultPath = join(vaultDir, 'test.nvx')
    await createVault(vaultPath, PASSWORD)
    await closeVault()
  }, 60_000)

  // A failed assertion would otherwise leave the vault open for the next case.
  afterEach(async () => {
    await closeVault()
  })

  afterAll(() => {
    vi.mocked(calibrateArgon2id).mockReset()
    rmSync(vaultDir, { recursive: true, force: true })
  })

  it('keeps an edit when the operation before the close resolved with a value (notes:list)', async () => {
    await openVault(vaultPath, PASSWORD)
    const note = await createNote(getDb(), { title: 'Draft', content: 'before' }, getMasterKey())
    await updateNote(getDb(), note.id, { content: 'after' }, getMasterKey())

    void withVaultLock(() => listNotes(getDb(), getMasterKey()))
    await closeVault()

    await openVault(vaultPath, PASSWORD)
    expect((await getNote(getDb(), note.id, getMasterKey()))?.content).toBe('after')
  }, 60_000)

  // Characterization: a rejected predecessor reaches fn as undefined
  // (vaultOpLock swallows it), which is the skipPack default. This guards
  // the rejection path.
  it('keeps an edit when the operation before the close rejected', async () => {
    await openVault(vaultPath, PASSWORD)
    const note = await createNote(getDb(), { title: 'Draft', content: 'before' }, getMasterKey())
    await updateNote(getDb(), note.id, { content: 'after' }, getMasterKey())

    withVaultLock(() => Promise.reject(new Error('boom'))).catch(() => undefined)
    await closeVault()

    await openVault(vaultPath, PASSWORD)
    expect((await getNote(getDb(), note.id, getMasterKey()))?.content).toBe('after')
  }, 60_000)

  it('reports a successful close as packFailed: false', async () => {
    await openVault(vaultPath, PASSWORD)

    await expect(closeVault()).resolves.toEqual({ packFailed: false })
  }, 60_000)

  it('reports a failed pack on close and logs only the error code, never the vault path', async () => {
    await openVault(vaultPath, PASSWORD)
    // atomicWrite() writes <vault>.tmp first; a directory there makes the pack fail
    // without touching the .nvx itself.
    const blocker = vaultPath + '.tmp'
    mkdirSync(blocker)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(closeVault()).resolves.toEqual({ packFailed: true })

      expect(log).toHaveBeenCalledExactlyOnceWith('[close] pack failed:', expect.any(String))
      for (const arg of log.mock.calls[0]) expect(String(arg)).not.toContain(vaultDir)
      expect(isVaultOpen()).toBe(false)
    } finally {
      log.mockRestore()
      rmSync(blocker, { recursive: true, force: true })
    }
  }, 60_000)

  it('leaves the last packed .nvx intact and reopenable after a failed pack', async () => {
    await openVault(vaultPath, PASSWORD)
    const note = await createNote(getDb(), { title: 'Draft', content: 'packed' }, getMasterKey())
    await closeVault()
    await openVault(vaultPath, PASSWORD)
    await updateNote(getDb(), note.id, { content: 'lost' }, getMasterKey())
    const blocker = vaultPath + '.tmp'
    mkdirSync(blocker)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(closeVault()).resolves.toEqual({ packFailed: true })
    } finally {
      log.mockRestore()
      rmSync(blocker, { recursive: true, force: true })
    }

    // Reopening also proves the lock was released on the failure path
    await openVault(vaultPath, PASSWORD)
    expect((await getNote(getDb(), note.id, getMasterKey()))?.content).toBe('packed')
  }, 60_000)

  // The catch block is the only thing between a failed pack and the key wipe
  // and lock release below it; logging must not be able to throw out of it.
  it('still closes, wipes and unlocks when the pack rejects with something that is not an Error', async () => {
    await openVault(vaultPath, PASSWORD)
    const notAnError: unknown = null
    vi.mocked(getArgon2Params).mockImplementationOnce(() => {
      throw notAnError
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(closeVault()).resolves.toEqual({ packFailed: true })
      expect(log).toHaveBeenCalledExactlyOnceWith('[close] pack failed:', 'object')
      expect(isVaultOpen()).toBe(false)
    } finally {
      log.mockRestore()
    }

    await expect(openVault(vaultPath, PASSWORD)).resolves.not.toBeNull()
  }, 60_000)
})
