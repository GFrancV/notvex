// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  unconfirmedRecoveryVaults: [],
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  clipboardClearSeconds: 60,
  clearClipboardOnLock: true,
  noteSort: { field: 'updatedAt', direction: 'desc' },
  checkUpdatesOnStartup: true
}

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    vault: {
      chooseFile: vi.fn().mockResolvedValue({ success: true, data: CREATED_VAULT }),
      create: vi.fn().mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } }),
      confirmRecoverySaved: vi.fn().mockResolvedValue({ success: true, data: null })
    },
    prefs: { get: vi.fn().mockResolvedValue({ success: true, data: prefsAfterCreate }) }
  }
}))

const { notvex } = await import('@/lib/ipc')
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

  it('a lock while finishing stays on Unlock instead of opening the closed vault', async () => {
    let finishLoad!: () => void
    vi.mocked(notvex.prefs.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = () => resolve({ success: true, data: prefsAfterCreate })
        })
    )
    render(createElement(Setup))
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: PASSWORD } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }))
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start using Notvex' }))

    act(() => useVaultStore.getState().clearSession())
    await act(async () => finishLoad())

    expect(useVaultStore.getState().status).toBe('locked')
  })

  it('tells main the recovery key was saved', async () => {
    vi.mocked(notvex.vault.confirmRecoverySaved).mockClear()
    await finishSetup()

    expect(notvex.vault.confirmRecoverySaved).toHaveBeenCalledOnce()
  })
})

describe('Setup on first run', () => {
  afterEach(cleanup)

  beforeEach(() => {
    useVaultStore.setState({ status: 'uninitialized', pendingNewVaultPath: null })
    usePrefsStore.setState({ recentVaults: [] })
  })

  // Prefs still have no vault until Setup finishes, so only this path tells Unlock where it is.
  it('a lock on the recovery step leaves Unlock pointed at the created vault', async () => {
    render(createElement(Setup))
    fireEvent.click(
      screen.getByPlaceholderText('Choose where to save...').nextElementSibling as HTMLElement
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: PASSWORD } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }))
    await screen.findByRole('checkbox')

    act(() => useVaultStore.getState().clearSession())

    expect(useVaultStore.getState().pendingOpenVaultPath).toBe(CREATED_VAULT)
  })
})
