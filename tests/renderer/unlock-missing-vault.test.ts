// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VAULT = '/vaults/main.nvx'

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    prefs: { get: vi.fn(), removeRecentVault: vi.fn() },
    vault: {
      getUnlockThrottleStatus: vi.fn().mockResolvedValue({
        success: true,
        data: { isThrottled: false, waitSeconds: 0, failedAttempts: 0 }
      }),
      chooseFile: vi.fn(),
      hasVault: vi.fn(),
      open: vi.fn(),
      openWithRecovery: vi.fn()
    }
  }
}))

const { Unlock } = await import('@/views/unlock')
const { notvex } = await import('@/lib/ipc')
const { useVaultStore } = await import('@/store/vault.store')
const { usePrefsStore } = await import('@/store/prefs.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

describe('Unlock with a vault that can not be opened', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(notvex.vault.hasVault).mockResolvedValue({ success: true, data: 'missing' })
    useVaultStore.setState({ status: 'locked', pendingOpenVaultPath: null })
    usePrefsStore.setState({
      recentVaults: [{ path: VAULT, hasKeyFile: false, lastOpenedAt: 1 }]
    })
  })

  it("says the vault couldn't be found, with its name and full location", async () => {
    render(createElement(Unlock), { wrapper: TooltipProvider })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't find this vault")
    expect(alert.textContent).toContain(
      "main.nvx isn't at /vaults/main.nvx. It may have been moved, renamed or be on a disconnected drive."
    )
    await waitFor(() => expect(notvex.vault.hasVault).toHaveBeenCalledWith(VAULT))
  })

  it('keeps the first recent vault as the target and offers no password form', async () => {
    usePrefsStore.setState({
      recentVaults: [
        { path: VAULT, hasKeyFile: false, lastOpenedAt: 2 },
        { path: '/vaults/other.nvx', hasKeyFile: false, lastOpenedAt: 1 }
      ]
    })
    render(createElement(Unlock), { wrapper: TooltipProvider })

    await screen.findByRole('alert')
    expect(screen.queryByLabelText('Master password')).toBeNull()
    expect(notvex.vault.hasVault).toHaveBeenCalledExactlyOnceWith(VAULT)
  })

  it('focuses "Try again" when the message appears', async () => {
    render(createElement(Unlock), { wrapper: TooltipProvider })

    await screen.findByRole('alert')

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
    )
  })

  it('shows the password form when the file is usable again and "Try again" is pressed', async () => {
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByRole('alert')
    vi.mocked(notvex.vault.hasVault).mockResolvedValue({ success: true, data: 'usable' })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    const password = await screen.findByLabelText('Master password')
    await waitFor(() => expect(document.activeElement).toBe(password))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('announces a failed retry and updates the message to the current case', async () => {
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByRole('alert')
    vi.mocked(notvex.vault.hasVault).mockResolvedValue({ success: true, data: 'not-vault' })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    const status = await screen.findByText("Still couldn't open this vault")
    expect(status.closest('[aria-live="polite"]')).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toContain("isn't a Notvex vault")
    expect(screen.queryByLabelText('Master password')).toBeNull()
  })

  it('removes the vault on request and shows the next recent vault', async () => {
    const other = { path: '/vaults/other.nvx', hasKeyFile: false, lastOpenedAt: 1 }
    usePrefsStore.setState({
      recentVaults: [{ path: VAULT, hasKeyFile: false, lastOpenedAt: 2 }, other]
    })
    vi.mocked(notvex.vault.hasVault).mockImplementation(async (path) => ({
      success: true,
      data: path === VAULT ? 'missing' : 'usable'
    }))
    vi.mocked(notvex.prefs.removeRecentVault).mockResolvedValue({ success: true, data: null })
    vi.mocked(notvex.prefs.get).mockResolvedValue({
      success: true,
      data: { recentVaults: [other] } as never
    })
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: 'Remove from recent vaults' }))

    await screen.findByLabelText('Master password')
    expect(notvex.prefs.removeRecentVault).toHaveBeenCalledExactlyOnceWith(VAULT)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /other\.nvx/ })).toBeTruthy()
  })

  it('goes to the first-run screen when the removed vault was the only one', async () => {
    vi.mocked(notvex.prefs.removeRecentVault).mockResolvedValue({ success: true, data: null })
    vi.mocked(notvex.prefs.get).mockResolvedValue({
      success: true,
      data: { recentVaults: [] } as never
    })
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: 'Remove from recent vaults' }))

    await waitFor(() => expect(useVaultStore.getState().status).toBe('uninitialized'))
  })

  it('opens another vault from the message and shows its form', async () => {
    const OTHER = '/vaults/other.nvx'
    vi.mocked(notvex.vault.hasVault).mockImplementation(async (path) => ({
      success: true,
      data: path === VAULT ? 'missing' : 'usable'
    }))
    vi.mocked(notvex.vault.chooseFile).mockResolvedValue({ success: true, data: OTHER })
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: 'Open existing vault' }))

    const password = await screen.findByLabelText('Master password')
    await waitFor(() => expect(document.activeElement).toBe(password))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(OTHER) })).toBeTruthy()
  })

  it('starts creating a vault from the message', async () => {
    vi.mocked(notvex.vault.chooseFile).mockResolvedValue({
      success: true,
      data: '/vaults/new.nvx'
    })
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: 'Create new vault' }))

    await waitFor(() =>
      expect(useVaultStore.getState().pendingNewVaultPath).toBe('/vaults/new.nvx')
    )
    expect(notvex.vault.chooseFile).toHaveBeenCalledWith('new')
  })

  it.each([
    [
      'not-vault',
      "Couldn't open this vault",
      "The file at /vaults/main.nvx isn't a Notvex vault. It may have been replaced by another file."
    ],
    [
      'unreadable',
      "Couldn't open this vault",
      "Notvex can't read /vaults/main.nvx. Check that it isn't open in another program and that you can access it."
    ]
  ] as const)('shows the message for a %s file', async (status, title, body) => {
    vi.mocked(notvex.vault.hasVault).mockResolvedValue({ success: true, data: status })
    render(createElement(Unlock), { wrapper: TooltipProvider })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(title)
    expect(alert.textContent).toContain(body)
  })
})

describe('Unlock with no saved vault', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    useVaultStore.setState({ status: 'locked', pendingOpenVaultPath: null })
    usePrefsStore.setState({ recentVaults: [] })
  })

  it('says there is no saved vault instead of blaming a saved location', () => {
    render(createElement(Unlock), { wrapper: TooltipProvider })

    expect(
      screen.getByText('No saved vault found. Create a new vault or open an existing one.')
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create new vault' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open existing vault' })).toBeTruthy()
  })
})
