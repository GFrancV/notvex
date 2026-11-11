import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { vaultFileStatus } from '@main/vault/container'

// Real files on disk: the point is what the file system reports, not what a mock says.

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'notvex-file-check-'))
  writeFileSync(join(dir, 'vault.nvx'), Buffer.concat([Buffer.from('NVX\0'), Buffer.alloc(16)]))
  writeFileSync(join(dir, 'other.nvx'), 'SQLite format 3\0')
  writeFileSync(join(dir, 'empty.nvx'), '')
  mkdirSync(join(dir, 'folder.nvx'))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('vaultFileStatus', () => {
  it.each([
    ['a Notvex file', 'vault.nvx', 'usable'],
    ['a path with no file', 'gone.nvx', 'missing'],
    ['a file with another magic', 'other.nvx', 'not-vault'],
    ['an empty file', 'empty.nvx', 'not-vault'],
    ['a path that opens but can not be read as a file', 'folder.nvx', 'unreadable']
  ])('classifies %s', (_label, name, expected) => {
    expect(vaultFileStatus(join(dir, name))).toBe(expected)
  })
})
