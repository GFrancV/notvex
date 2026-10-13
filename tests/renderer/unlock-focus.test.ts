// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VAULT = '/vaults/main.nvx'
const OTHER_VAULT = '/vaults/other.nvx'

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    vault: {
      getUnlockThrottleStatus: vi.fn().mockResolvedValue({
        success: true,
        data: { isThrottled: false, waitSeconds: 0, failedAttempts: 0 }
      }),
      chooseFile: vi.fn().mockResolvedValue({ success: true, data: OTHER_VAULT }),
      hasVault: vi.fn().mockResolvedValue({ success: true, data: true })
    }
  }
}))

const { Unlock } = await import('@/views/unlock')
const { notvex } = await import('@/lib/ipc')
const { useVaultStore } = await import('@/store/vault.store')
const { usePrefsStore } = await import('@/store/prefs.store')

async function renderUnlock(): Promise<void> {
  render(createElement(Unlock))
  // Let the mount-time throttle fetch settle so its state update lands inside act.
  await waitFor(() => expect(notvex.vault.getUnlockThrottleStatus).toHaveBeenCalled())
}

const passwordInput = (): HTMLElement => screen.getByLabelText('Master password')
const recoveryTextarea = (): HTMLElement => screen.getByPlaceholderText(/24-word recovery phrase/)

describe('Unlock focus', () => {
  afterEach(cleanup)

  beforeEach(() => {
    useVaultStore.setState({ status: 'locked', pendingOpenVaultPath: null })
    usePrefsStore.setState({
      recentVaults: [{ path: VAULT, hasKeyFile: false, lastOpenedAt: 1 }]
    })
  })

  it('focuses the password input on mount', async () => {
    await renderUnlock()

    expect(document.activeElement).toBe(passwordInput())
  })

  it('focuses the recovery textarea after switching to recovery mode', async () => {
    await renderUnlock()

    fireEvent.click(screen.getByRole('button', { name: /Use recovery key/ }))

    expect(document.activeElement).toBe(recoveryTextarea())
  })

  it('focuses the password input after switching back from recovery mode', async () => {
    await renderUnlock()

    fireEvent.click(screen.getByRole('button', { name: /Use recovery key/ }))
    fireEvent.click(screen.getByRole('button', { name: /Back to unlock/ }))

    expect(document.activeElement).toBe(passwordInput())
  })

  it('refocuses the password input after picking another vault', async () => {
    await renderUnlock()
    const vaultButton = screen.getByRole('button', { name: new RegExp(VAULT) })
    vaultButton.focus()

    fireEvent.click(vaultButton)

    await waitFor(() => expect(document.activeElement).toBe(passwordInput()))
  })

  it('refocuses the password input when a vault file is opened while unlocking', async () => {
    await renderUnlock()
    screen.getByRole('button', { name: 'Advanced options' }).focus()

    act(() => useVaultStore.setState({ pendingOpenVaultPath: OTHER_VAULT }))

    await waitFor(() => expect(document.activeElement).toBe(passwordInput()))
  })

  it('focuses the password input after picking a vault from the not-found state', async () => {
    usePrefsStore.setState({ recentVaults: [] })
    render(createElement(Unlock))

    fireEvent.click(screen.getByRole('button', { name: 'Open existing vault' }))

    await waitFor(() => expect(document.activeElement).toBe(passwordInput()))
  })
})
