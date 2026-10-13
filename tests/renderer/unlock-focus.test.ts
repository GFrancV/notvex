// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VAULT = '/vaults/main.nvx'
const OTHER_VAULT = '/vaults/other.nvx'
const MNEMONIC = Array.from({ length: 24 }, (_, i) => `word${i}`).join(' ')

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    vault: {
      getUnlockThrottleStatus: vi.fn().mockResolvedValue({
        success: true,
        data: { isThrottled: false, waitSeconds: 0, failedAttempts: 0 }
      }),
      chooseFile: vi.fn().mockResolvedValue({ success: true, data: OTHER_VAULT }),
      hasVault: vi.fn().mockResolvedValue({ success: true, data: true }),
      open: vi.fn(),
      openWithRecovery: vi.fn()
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

const failures = [
  ['a rejected credential', { success: true, data: null }],
  ['an IPC error', { success: false, error: 'Vault file is corrupted' }]
] as const

const cancellations = ['MIGRATION_CANCELLED', 'DEV_BUILD_WARNING_CANCELLED'] as const

const passwordInput = (): HTMLElement => screen.getByLabelText('Master password')
const recoveryTextarea = (): HTMLElement => screen.getByPlaceholderText(/24-word recovery phrase/)

describe('Unlock focus', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(notvex.vault.open).mockReset()
    vi.mocked(notvex.vault.openWithRecovery).mockReset()
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

  it.each(failures)('refocuses and selects the password after %s', async (_, res) => {
    vi.mocked(notvex.vault.open).mockResolvedValueOnce(res)
    await renderUnlock()
    fireEvent.change(passwordInput(), { target: { value: 'wrong password' } })
    const unlockButton = screen.getByRole('button', { name: 'Unlock' })
    unlockButton.focus()

    fireEvent.click(unlockButton)

    const input = passwordInput() as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'wrong password'.length])
  })

  it('selects the password after a failed unlock via Enter', async () => {
    vi.mocked(notvex.vault.open).mockResolvedValueOnce({ success: true, data: null })
    await renderUnlock()
    const input = passwordInput() as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wrong password' } })

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(input.selectionStart).toBe(0))
    expect(input.selectionEnd).toBe('wrong password'.length)
    expect(document.activeElement).toBe(input)
  })

  it.each(failures)(
    'refocuses the recovery phrase without selecting it after %s',
    async (_, res) => {
      vi.mocked(notvex.vault.openWithRecovery).mockResolvedValueOnce(res)
      await renderUnlock()
      fireEvent.click(screen.getByRole('button', { name: /Use recovery key/ }))
      fireEvent.change(recoveryTextarea(), { target: { value: MNEMONIC } })
      const recoverButton = screen.getByRole('button', { name: 'Recover Access' })
      recoverButton.focus()

      fireEvent.click(recoverButton)

      const textarea = recoveryTextarea() as HTMLTextAreaElement
      await waitFor(() => expect(document.activeElement).toBe(textarea))
      expect(textarea.selectionStart).toBe(textarea.selectionEnd)
    }
  )

  it.each(cancellations)('does not focus the password input on %s', async (error) => {
    vi.mocked(notvex.vault.open).mockResolvedValueOnce({ success: false, error })
    await renderUnlock()
    fireEvent.change(passwordInput(), { target: { value: 'some password' } })
    const unlockButton = screen.getByRole('button', { name: 'Unlock' })
    unlockButton.focus()

    fireEvent.click(unlockButton)

    await waitFor(() => expect(notvex.vault.open).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(unlockButton).toHaveProperty('disabled', false))
    expect(document.activeElement).not.toBe(passwordInput())
  })

  it.each(cancellations)('does not focus the recovery phrase on %s', async (error) => {
    vi.mocked(notvex.vault.openWithRecovery).mockResolvedValueOnce({ success: false, error })
    await renderUnlock()
    fireEvent.click(screen.getByRole('button', { name: /Use recovery key/ }))
    fireEvent.change(recoveryTextarea(), { target: { value: MNEMONIC } })
    const recoverButton = screen.getByRole('button', { name: 'Recover Access' })
    recoverButton.focus()

    fireEvent.click(recoverButton)

    await waitFor(() => expect(notvex.vault.openWithRecovery).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(recoverButton).toHaveProperty('disabled', false))
    expect(document.activeElement).not.toBe(recoveryTextarea())
  })
})
