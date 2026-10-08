import { randomBytes } from 'crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'
import { expect, vi, type Mock } from 'vitest'

import { dbAll } from '@main/db/queries'
import { readContainer } from '@main/vault/container'
import { decryptField, deriveKey, memzero } from '@main/vault/crypto'
import {
  changePassword,
  configureKeyFile,
  createVault,
  getDb,
  openVault,
  removeKeyFile,
  rotateVaultCredentials
} from '@main/vault/vault'

interface RawNoteRow {
  id: string
  title: Buffer
  title_iv: Buffer
}

// Reads note titles straight from the packed .nvx on disk, independent of the live session
// (which would see notes that never reached the file).
export async function readNoteTitlesFromPackedContainer(
  vaultPath: string,
  masterKey: Uint8Array
): Promise<Map<string, string>> {
  const fileBytes = readFileSync(vaultPath)
  const metadata = readContainer(fileBytes)
  const dbPath = join(tmpdir(), `notvex_test_read_${randomBytes(8).toString('hex')}.db`)
  writeFileSync(dbPath, fileBytes.subarray(metadata.dbOffset))

  const hex = Buffer.from(masterKey).toString('hex')
  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlcipher.Database(dbPath, (err) =>
      err ? reject(err) : resolve(database)
    )
  })

  try {
    await new Promise<void>((resolve, reject) => {
      db.run(`PRAGMA key = "x'${hex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
    })
    const rows = await dbAll<RawNoteRow>(db, 'SELECT id, title, title_iv FROM notes')
    const titles = new Map<string, string>()
    for (const row of rows) {
      titles.set(
        row.id,
        decryptField(new Uint8Array(row.title), new Uint8Array(row.title_iv), masterKey)
      )
    }
    return titles
  } finally {
    await new Promise<void>((resolve) => db.close(() => resolve()))
    try {
      unlinkSync(dbPath)
    } catch {
      /* ignore */
    }
  }
}

export const ORIGINAL_PASSWORD = 'correct horse battery staple'
export const NEW_PASSWORD = 'a different correct horse battery staple'

// One entry per credential rotation. prepare() creates the vault (plus any precondition) and
// returns the rotation and how to reopen with the pre- and post-rotation credentials.
export interface RotationCase {
  name: string
  // deriveKey() calls the rotation itself makes; the last one is newRawKey
  // (authenticateVaultKey() derives once first, except in rotateVaultCredentials).
  deriveKeyCalls: number
  prepare: (vaultPath: string) => Promise<{
    rotate: () => Promise<unknown>
    reopenWithOriginal: () => ReturnType<typeof openVault>
    reopenWithNew: () => ReturnType<typeof openVault>
  }>
}

export const ROTATION_CASES: RotationCase[] = [
  {
    name: 'changePassword',
    deriveKeyCalls: 2,
    prepare: async (vaultPath) => {
      await createVault(vaultPath, ORIGINAL_PASSWORD)
      return {
        rotate: () => changePassword(ORIGINAL_PASSWORD, NEW_PASSWORD),
        reopenWithOriginal: () => openVault(vaultPath, ORIGINAL_PASSWORD),
        reopenWithNew: () => openVault(vaultPath, NEW_PASSWORD)
      }
    }
  },
  {
    name: 'rotateVaultCredentials',
    deriveKeyCalls: 1,
    prepare: async (vaultPath) => {
      await createVault(vaultPath, ORIGINAL_PASSWORD)
      return {
        rotate: () => rotateVaultCredentials(NEW_PASSWORD),
        reopenWithOriginal: () => openVault(vaultPath, ORIGINAL_PASSWORD),
        reopenWithNew: () => openVault(vaultPath, NEW_PASSWORD)
      }
    }
  },
  {
    name: 'configureKeyFile',
    deriveKeyCalls: 2,
    prepare: async (vaultPath) => {
      await createVault(vaultPath, ORIGINAL_PASSWORD)
      const keyFileContents = randomBytes(32)
      return {
        rotate: () => configureKeyFile(ORIGINAL_PASSWORD, keyFileContents),
        reopenWithOriginal: () => openVault(vaultPath, ORIGINAL_PASSWORD),
        reopenWithNew: () => openVault(vaultPath, ORIGINAL_PASSWORD, keyFileContents)
      }
    }
  },
  {
    name: 'removeKeyFile',
    deriveKeyCalls: 2,
    prepare: async (vaultPath) => {
      await createVault(vaultPath, ORIGINAL_PASSWORD)
      // removeKeyFile() requires a key file to already be configured.
      const keyFileContents = randomBytes(32)
      await configureKeyFile(ORIGINAL_PASSWORD, keyFileContents)
      return {
        rotate: () => removeKeyFile(ORIGINAL_PASSWORD, keyFileContents),
        reopenWithOriginal: () => openVault(vaultPath, ORIGINAL_PASSWORD, keyFileContents),
        reopenWithNew: () => openVault(vaultPath, ORIGINAL_PASSWORD)
      }
    }
  }
]

// Fails the next `times` liveDb.run() calls matching matchSql; all others pass through.
// The caller restores the spy.
export function forceNextDbRunToFail(
  matchSql: (sql: string) => boolean,
  errorMessage: string,
  times = 1
): ReturnType<typeof vi.spyOn> {
  const liveDb = getDb()
  const originalRun = liveDb.run.bind(liveDb)
  let remaining = times
  return vi.spyOn(liveDb, 'run').mockImplementation((sql: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as (err: Error | null) => void
    if (typeof sql === 'string' && remaining > 0 && matchSql(sql)) {
      remaining -= 1
      callback(new Error(errorMessage))
      return liveDb
    }
    return originalRun(sql, ...(rest as Parameters<typeof originalRun>[]))
  })
}

// Asserts the `expectedDeriveCalls`-th deriveKey() result (newRawKey) is all zero and went
// through memzero() by reference. Coupling: newRawKey is picked by call ordinal, so a deriveKey()
// call added or reordered ahead of it makes this silently check authenticateVaultKey()'s
// buffer instead. Re-check the ordinals when those call sites change.
export function expectNewRawKeyZeroed(
  deriveKeySpy: Mock<typeof deriveKey>,
  memzeroSpy: Mock<typeof memzero>,
  expectedDeriveCalls: number
): void {
  expect(deriveKeySpy).toHaveBeenCalledTimes(expectedDeriveCalls)
  const newRawKeyRef = deriveKeySpy.mock.results[expectedDeriveCalls - 1].value as Uint8Array
  expect(newRawKeyRef.length).toBeGreaterThan(0)
  expect(Array.from(newRawKeyRef).every((byte) => byte === 0)).toBe(true)
  expect(memzeroSpy.mock.calls.some(([buf]) => buf === newRawKeyRef)).toBe(true)
}

// Finds every Buffer.from(newRawKey) copy by reference, pins how many there are (a rotation
// makes two: newHex source, writeContainer masterKey) and asserts each is zeroed.
export function expectNewRawKeyCopiesZeroed(
  bufferFromSpy: ReturnType<typeof vi.spyOn>,
  newRawKeyRef: Uint8Array,
  expectedCopies: number
): void {
  const copies: Buffer[] = []
  bufferFromSpy.mock.calls.forEach((args: unknown[], i: number) => {
    if (args[0] === newRawKeyRef) copies.push(bufferFromSpy.mock.results[i].value as Buffer)
  })

  expect(copies).toHaveLength(expectedCopies)
  for (const copy of copies) {
    expect(copy.length).toBeGreaterThan(0)
    expect(Array.from(copy).every((byte) => byte === 0)).toBe(true)
  }
}

// Success path: storeKey() and the outer finally both zero newRawKey; the second is a no-op.
export function expectNewRawKeyZeroedTwice(
  memzeroSpy: Mock<typeof memzero>,
  newRawKeyRef: Uint8Array
): void {
  expect(memzeroSpy.mock.calls.filter(([buf]) => buf === newRawKeyRef)).toHaveLength(2)
  expect(Array.from(newRawKeyRef).every((byte) => byte === 0)).toBe(true)
}

// The verify derive's Buffer copy (candidateKey) must go through memzero(), not fill(0).
export function expectVerifyKeyMemzeroed(
  bufferFromSpy: ReturnType<typeof vi.spyOn>,
  verifyDerivedRef: Uint8Array,
  memzeroSpy: Mock<typeof memzero>
): void {
  const idx = bufferFromSpy.mock.calls.findIndex((args: unknown[]) => args[0] === verifyDerivedRef)
  expect(idx).toBeGreaterThanOrEqual(0)
  const candidateKey = bufferFromSpy.mock.results[idx].value as Buffer
  expect(memzeroSpy.mock.calls.some(([buf]) => buf === candidateKey)).toBe(true)
  expect(Array.from(candidateKey).every((byte) => byte === 0)).toBe(true)
}
