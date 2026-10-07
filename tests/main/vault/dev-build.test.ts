import { randomBytes } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { readContainer } from '@main/vault/container'
import {
  changePassword,
  closeVault,
  configureKeyFile,
  createVault,
  removeKeyFile,
  rotateVaultCredentials
} from '@main/vault/vault'

describe('devBuild propagation (issue #34)', () => {
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

  it('createVault() defaults to devBuild: false when the argument is omitted', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple')

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(false)
  }, 90_000)

  it('createVault(devBuild: true) writes the flag, and a later rewrite (changePassword) preserves it', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const originalPassword = 'correct horse battery staple'

    await createVault(vaultPath, originalPassword, true)
    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)

    await changePassword(originalPassword, 'a different correct horse battery staple')

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)
  }, 120_000)

  // rotateVaultCredentials/configureKeyFile/removeKeyFile each have their own writeContainer()
  // call, so each needs its own check that it still passes devBuild.

  it('rotateVaultCredentials() preserves an existing devBuild: true flag', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')

    await createVault(vaultPath, 'correct horse battery staple', true)
    await rotateVaultCredentials('a different correct horse battery staple')

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)
  }, 120_000)

  it('configureKeyFile() preserves an existing devBuild: true flag', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const password = 'correct horse battery staple'

    await createVault(vaultPath, password, true)
    await configureKeyFile(password, randomBytes(32))

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)
  }, 120_000)

  it('removeKeyFile() preserves an existing devBuild: true flag', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    const vaultPath = join(vaultDir, 'test.nvx')
    const password = 'correct horse battery staple'
    const keyFileContents = randomBytes(32)

    await createVault(vaultPath, password, true)
    await configureKeyFile(password, keyFileContents)
    await removeKeyFile(password, keyFileContents)

    expect(readContainer(readFileSync(vaultPath)).devBuild).toBe(true)
  }, 150_000)
})
