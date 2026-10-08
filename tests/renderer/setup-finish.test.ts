// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prefs } from '@shared/types'

const PREVIOUS_VAULT = '/vaults/previous.nvx'
const CREATED_VAULT = '/vaults/created.nvx'
const PASSWORD = 'correct horse battery'
const MNEMONIC = Array.from({ length: 24 }, (_, i) => `word${i}`).join(' ')

// What main's prefs look like after vault:create recorded the new vault as most recent.
const prefsAfterCreate: Prefs = {
  recentVaults: [
    { path: CREATED_VAULT, hasKeyFile: false, lastOpenedAt: 2 },
    { path: PREVIOUS_VAULT, hasKeyFile: false, lastOpenedAt: 1 }
  ],
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  clipboardClearSeconds: 60
}

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    vault: {
      create: vi.fn().mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    },
    prefs: { get: vi.fn().mockResolvedValue({ success: true, data: prefsAfterCreate }) }
  }
}))

const { Setup } = await import('@/views/setup')
const { useVaultStore } = await import('@/store/vault.store')
const { usePrefsStore } = await import('@/store/prefs.store')

async function finishSetup(): Promise<void> {
  render(createElement(Setup))
  fireEvent.change(screen.getByLabelText('Master password'), { target: { value: PASSWORD } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } })
  fireEvent.click(screen.getByRole('button', { name: 'Create vault' }))
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Start using Notvex' }))
  await waitFor(() => expect(useVaultStore.getState().status).toBe('unlocked'))
}

describe('Setup finish', () => {
  afterEach(cleanup)

  beforeEach(() => {
    // Opened from the vault switcher while the previous vault was the most recent one.
    useVaultStore.setState({
      status: 'uninitialized',
      currentVaultPath: null,
      pendingNewVaultPath: CREATED_VAULT
    })
    usePrefsStore.setState({
      recentVaults: [{ path: PREVIOUS_VAULT, hasKeyFile: false, lastOpenedAt: 1 }]
    })
  })

  it('sets the current vault path to the created vault', async () => {
    await finishSetup()

    expect(useVaultStore.getState().currentVaultPath).toBe(CREATED_VAULT)
  })

  it('reloads prefs so the created vault is the most recent one', async () => {
    await finishSetup()

    expect(usePrefsStore.getState().recentVaults[0]?.path).toBe(CREATED_VAULT)
  })

  it('clears the pending new-vault path', async () => {
    await finishSetup()

    expect(useVaultStore.getState().pendingNewVaultPath).toBeNull()
  })
})
