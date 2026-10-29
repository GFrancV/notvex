import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { changePassword, createVault, rotateVaultCredentials } from '@main/vault/vault'

const TOO_SHORT = "Couldn't set the password: it needs at least 12 characters"

// The length rule applies to a password being set, never to one being checked at unlock: a vault
// created before the rule must still open. These run before any KDF work, with no vault open.
describe('new-password length', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('createVault refuses a password under 12 characters', async () => {
    dir = mkdtempSync(join(tmpdir(), 'notvex-pw-'))

    await expect(createVault(join(dir, 'v.nvx'), 'elevenchars')).rejects.toThrow(TOO_SHORT)
  })

  it('changePassword refuses a new password under 12 characters', async () => {
    await expect(changePassword('whatever current', 'elevenchars')).rejects.toThrow(TOO_SHORT)
  })

  it('rotateVaultCredentials refuses a new password under 12 characters', async () => {
    await expect(rotateVaultCredentials('elevenchars')).rejects.toThrow(TOO_SHORT)
  })
})
