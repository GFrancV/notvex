// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
      open: vi.fn(),
      openWithRecovery: vi.fn()
    }
  }
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

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
    useVaultStore.setState({ status: 'locked', pendingOpenVaultPath: null })
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
})
