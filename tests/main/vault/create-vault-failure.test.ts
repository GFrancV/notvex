import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeTempDbPath, writeContainer } from '@main/vault/container'
import { deriveKey } from '@main/vault/crypto'
import { allocSecure, freeSecure } from '@main/vault/memlock'
import { closeVault, createVault, isVaultOpen } from '@main/vault/vault'

// Pass-through spies: the tests need the exact key buffer and temp path createVault produced.
vi.mock('@main/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/crypto')>()
  return { ...actual, deriveKey: vi.fn(actual.deriveKey) }
})

vi.mock('@main/vault/container', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/container')>()
  return {
    ...actual,
    makeTempDbPath: vi.fn(actual.makeTempDbPath),
    writeContainer: vi.fn(actual.writeContainer)
  }
})

vi.mock('@main/vault/memlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/memlock')>()
  return {
    ...actual,
    allocSecure: vi.fn(actual.allocSecure),
    freeSecure: vi.fn(actual.freeSecure)
  }
})

const PASSWORD = 'correct horse battery staple'

function expectNothingLeftBehind(vaultPath: string): void {
  expect(existsSync(vaultPath)).toBe(false)
  expect(existsSync(vaultPath + '.tmp')).toBe(false)

  const tempDbs = vi.mocked(makeTempDbPath).mock.results.map((r) => r.value as string)
  expect(tempDbs.length).toBeGreaterThan(0)
  for (const tempDb of tempDbs) expect(existsSync(tempDb)).toBe(false)

  const derived = vi.mocked(deriveKey).mock.results
  expect(derived).toHaveLength(1)
  const rawKey = derived[0].value as Uint8Array
  expect(rawKey.length).toBeGreaterThan(0)
  expect(rawKey.every((byte) => byte === 0)).toBe(true)
  // The session's secure copy of the key, when the failure came after it was made
  for (const { value } of vi.mocked(allocSecure).mock.results) {
    expect((value as Buffer).every((byte) => byte === 0)).toBe(true)
  }

  expect(isVaultOpen()).toBe(false)
}

describe('createVault() failing after the key derivation', () => {
  let vaultDir: string

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    vi.mocked(deriveKey).mockClear()
    vi.mocked(makeTempDbPath).mockClear()
    vi.mocked(allocSecure).mockClear()
  })

  afterEach(async () => {
    try {
      await closeVault()
    } catch {
      /* ignore */
    }
    rmSync(vaultDir, { recursive: true, force: true })
  })

  it("the destination folder can't be written: nothing is left behind and no vault is open", async () => {
    const vaultPath = join(vaultDir, 'missing-folder', 'test.nvx')

    await expect(createVault(vaultPath, PASSWORD)).rejects.toThrow(/ENOENT/)
    expect(allocSecure).toHaveBeenCalled()

    expectNothingLeftBehind(vaultPath)
  }, 60_000)

  it('releasing the memory lock fails during the cleanup: the rest still runs and the original error is shown', async () => {
    const vaultPath = join(vaultDir, 'missing-folder', 'test.nvx')
    // The buffer is zeroed first, as freeSecure does; the unlock is what throws.
    vi.mocked(freeSecure).mockImplementationOnce((buf) => {
      buf.fill(0)
      throw new Error('simulated unlock failure')
    })

    await expect(createVault(vaultPath, PASSWORD)).rejects.toThrow(/ENOENT/)
    expect(freeSecure).toHaveBeenCalled()

    expectNothingLeftBehind(vaultPath)
  }, 60_000)

  it("the destination can't be replaced: the partial .tmp next to it is removed", async () => {
    // A non-empty folder at the chosen path: the .tmp is written, the rename over it fails.
    const vaultPath = join(vaultDir, 'test.nvx')
    mkdirSync(vaultPath)
    writeFileSync(join(vaultPath, 'keep.txt'), 'x')

    // Failing in the rename proves the .tmp was written first
    await expect(createVault(vaultPath, PASSWORD)).rejects.toMatchObject({ syscall: 'rename' })
    expect(existsSync(join(vaultPath, 'keep.txt'))).toBe(true)

    // The folder is the test's own; removing it lets the shared check run on the rest
    rmSync(vaultPath, { recursive: true })
    expectNothingLeftBehind(vaultPath)
  }, 60_000)

  it('reopening the session database fails: no vault file is written', async () => {
    const vaultPath = join(vaultDir, 'test.nvx')
    // The first PRAGMA key builds the new database; the second keys the reopened session one.
    const originalRun = sqlcipher.Database.prototype.run
    let keyCalls = 0
    const runSpy = vi.spyOn(sqlcipher.Database.prototype, 'run').mockImplementation(function (
      this: sqlite3.Database,
      sql: string,
      ...rest: unknown[]
    ) {
      if (sql.startsWith('PRAGMA key') && ++keyCalls === 2) {
        const callback = rest[rest.length - 1] as (err: Error | null) => void
        callback(new Error('simulated reopen failure'))
        return this
      }
      return originalRun.call(this, sql, ...rest)
    })

    try {
      await expect(createVault(vaultPath, PASSWORD)).rejects.toThrow('simulated reopen failure')
    } finally {
      runSpy.mockRestore()
    }

    expectNothingLeftBehind(vaultPath)
  }, 60_000)

  it('packing the container fails: the key and temporary database are cleaned up', async () => {
    const vaultPath = join(vaultDir, 'test.nvx')
    vi.mocked(writeContainer).mockImplementationOnce(() => {
      throw new Error('simulated packing failure')
    })

    await expect(createVault(vaultPath, PASSWORD)).rejects.toThrow('simulated packing failure')

    expectNothingLeftBehind(vaultPath)
  }, 60_000)
})
