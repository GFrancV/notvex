// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MAIN = '/vaults/main.nvx'
const OTHER = '/vaults/other.nvx'
const GONE = '/vaults/gone.nvx'

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
      switchTo: vi.fn(),
      open: vi.fn(),
      openWithRecovery: vi.fn()
    }
  }
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }))

// Radix positions tooltips with ResizeObserver, which jsdom doesn't implement.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const { Unlock } = await import('@/views/unlock')
const { notvex } = await import('@/lib/ipc')
const { toast } = await import('sonner')
const { useVaultStore } = await import('@/store/vault.store')
const { usePrefsStore } = await import('@/store/prefs.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

async function openSelector(): Promise<void> {
  render(createElement(Unlock), { wrapper: TooltipProvider })
  await screen.findByLabelText('Master password')
  fireEvent.keyDown(screen.getByRole('button', { name: /main\.nvx/ }), { key: 'Enter' })
}

describe('Unlock vault selector', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(notvex.vault.hasVault).mockImplementation(async (path) => ({
      success: true,
      data: path === GONE ? 'missing' : 'usable'
    }))
    // Failing keeps the seeded recentVaults, as when main has nothing newer to report
    vi.mocked(notvex.prefs.get).mockResolvedValue({ success: false, error: 'not needed' })
    useVaultStore.setState({
      status: 'locked',
      pendingNewVaultPath: null,
      pendingOpenVaultPath: null
    })
    usePrefsStore.setState({
      recentVaults: [
        { path: MAIN, lastOpenedAt: 3 },
        { path: OTHER, lastOpenedAt: 2 },
        { path: GONE, lastOpenedAt: 1 }
      ]
    })
  })

  it('lists the known vaults, then opening and creating', async () => {
    await openSelector()
    await screen.findByRole('menuitem', { name: /gone\.nvx.*Not found/ })

    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'vaults • main.nvx',
      'vaults • other.nvx',
      'vaults • gone.nvxNot found',
      'Open existing vault…',
      'Create new vault…'
    ])
    expect(items[0].getAttribute('aria-label')).toBe('vaults • main.nvx, current vault')
    expect(items[0].querySelector('.lucide-check')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Remove .*other\.nvx/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Remove .*gone\.nvx/ })).toBeTruthy()
  })

  it('lists the vault on screen as current, first and without ×, when it is not in recents', async () => {
    const OUTSIDE = '/elsewhere/outside.nvx'
    useVaultStore.setState({ pendingOpenVaultPath: OUTSIDE })
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByLabelText('Master password')
    fireEvent.keyDown(screen.getByRole('button', { name: /outside\.nvx/ }), { key: 'Enter' })
    await screen.findByRole('menuitem', { name: /gone\.nvx.*Not found/ })

    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent).slice(0, 2)).toEqual([
      'elsewhere • outside.nvx',
      'vaults • main.nvx'
    ])
    expect(items[0].getAttribute('aria-label')).toBe('elsewhere • outside.nvx, current vault')
    expect(items[0].querySelector('.lucide-check')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /Remove .*outside\.nvx/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Remove .*main\.nvx/ })).toBeTruthy()
  })

  it('shows the unlock form of the picked vault with the password focused', async () => {
    await openSelector()

    fireEvent.click(await screen.findByRole('menuitem', { name: /other\.nvx/ }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'vaults • other.nvx' })).toBeTruthy()
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Master password'))
    )
    expect(notvex.vault.hasVault).toHaveBeenCalledWith(OTHER)
    expect(notvex.vault.switchTo).not.toHaveBeenCalled()
  })

  it('asks for the password, not the recovery key, when another vault is picked', async () => {
    render(createElement(Unlock), { wrapper: TooltipProvider })
    fireEvent.click(await screen.findByRole('button', { name: /Use recovery key/ }))
    await screen.findByLabelText('Recovery phrase')

    fireEvent.keyDown(screen.getByRole('button', { name: /main\.nvx/ }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /other\.nvx/ }))

    expect(await screen.findByLabelText('Master password')).toBeTruthy()
    expect(screen.queryByLabelText('Recovery phrase')).toBeNull()
  })

  it('removes another vault from the list and keeps the selector open', async () => {
    vi.mocked(notvex.prefs.removeRecentVault).mockImplementation(async () => {
      vi.mocked(notvex.prefs.get).mockResolvedValue({
        success: true,
        data: {
          recentVaults: [
            { path: MAIN, lastOpenedAt: 3 },
            { path: GONE, lastOpenedAt: 1 }
          ]
        } as never
      })
      return { success: true, data: null }
    })
    await openSelector()
    expect(screen.queryByRole('button', { name: /Remove .*main\.nvx/ })).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: /Remove .*other\.nvx/ }))

    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /other\.nvx/ })).toBeNull())
    expect(notvex.prefs.removeRecentVault).toHaveBeenCalledExactlyOnceWith(OTHER)
    expect(screen.getByRole('menuitem', { name: /Create new vault…/ })).toBeTruthy()
    expect(notvex.vault.switchTo).not.toHaveBeenCalled()
  })

  it('"Create new vault…" checks the chosen file, then starts creating it', async () => {
    const NEW = '/vaults/new.nvx'
    vi.mocked(notvex.vault.chooseFile).mockResolvedValue({ success: true, data: NEW })
    vi.mocked(notvex.vault.hasVault).mockImplementation(async (path) => ({
      success: true,
      data: path === NEW || path === GONE ? 'missing' : 'usable'
    }))
    await openSelector()

    fireEvent.click(await screen.findByRole('menuitem', { name: /Create new vault…/ }))

    await waitFor(() => expect(useVaultStore.getState().pendingNewVaultPath).toBe(NEW))
    expect(notvex.vault.chooseFile).toHaveBeenCalledExactlyOnceWith('new')
    expect(notvex.vault.hasVault).toHaveBeenCalledWith(NEW)
  })

  it('"Create new vault…" on an existing vault starts nothing and offers to open it', async () => {
    vi.mocked(notvex.vault.chooseFile).mockResolvedValue({ success: true, data: OTHER })
    await openSelector()

    fireEvent.click(await screen.findByRole('menuitem', { name: /Create new vault…/ }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        'That file is already a Notvex vault',
        expect.objectContaining({ description: 'vaults • other.nvx', duration: Infinity })
      )
    )
    expect(useVaultStore.getState().pendingNewVaultPath).toBeNull()

    const options = vi.mocked(toast.error).mock.calls[0][1] as {
      action: { label: string; onClick: () => void }
    }
    expect(options.action.label).toBe('Open it')
    act(() => options.action.onClick())

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'vaults • other.nvx' })).toBeTruthy()
    )
    expect(screen.getByLabelText('Master password')).toBeTruthy()
  })

  it('shows the vault as folder • file, with its full path on hover', async () => {
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByLabelText('Master password')
    const selector = screen.getByRole('button', { name: /main\.nvx/ })
    expect(selector.textContent).toBe('vaults • main.nvx')

    fireEvent.pointerMove(screen.getByText('vaults • main.nvx'))

    expect((await screen.findByRole('tooltip')).textContent).toBe(MAIN)
  })

  it('has no separate link to create a vault under the unlock form', async () => {
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await screen.findByLabelText('Master password')

    expect(screen.queryByRole('button', { name: /Create (a )?new vault/ })).toBeNull()
  })

  it('shows why a picked vault can not be opened instead of its form', async () => {
    await openSelector()

    fireEvent.click(await screen.findByRole('menuitem', { name: /gone\.nvx.*Not found/ }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't find this vault")
    expect(alert.textContent).toContain(`gone.nvx isn't at ${GONE}.`)
    expect(screen.queryByLabelText('Master password')).toBeNull()
    expect(screen.getByRole('button', { name: 'vaults • gone.nvx' })).toBeTruthy()
  })
})
