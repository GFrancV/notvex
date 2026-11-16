// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VAULT = '/vaults/main.nvx'
const KEY_FILE = new Uint8Array([1, 2, 3])

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    vault: {
      getUnlockThrottleStatus: vi.fn().mockResolvedValue({
        success: true,
        data: { isThrottled: false, waitSeconds: 0, failedAttempts: 0 }
      }),
      hasVault: vi.fn().mockResolvedValue({ success: true, data: 'usable' }),
      selectKeyFile: vi.fn().mockResolvedValue({
        success: true,
        data: { contents: new Uint8Array([1, 2, 3]), filename: 'my.key', sizeBytes: 3 }
      }),
      open: vi.fn().mockResolvedValue({ success: true, data: null })
    }
  }
}))

const { Unlock } = await import('@/views/unlock')
const { notvex } = await import('@/lib/ipc')
const { useVaultStore } = await import('@/store/vault.store')
const { usePrefsStore } = await import('@/store/prefs.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

const advancedTrigger = (): HTMLElement => screen.getByRole('button', { name: 'Advanced options' })

describe('Unlock advanced options', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    useVaultStore.setState({ status: 'locked', pendingOpenVaultPath: null })
    usePrefsStore.setState({ recentVaults: [{ path: VAULT, lastOpenedAt: 1 }] })
  })

  async function renderUnlock(): Promise<void> {
    render(createElement(Unlock), { wrapper: TooltipProvider })
    await waitFor(() => expect(notvex.vault.getUnlockThrottleStatus).toHaveBeenCalled())
  }

  it('starts collapsed', async () => {
    await renderUnlock()

    expect(advancedTrigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('still unlocks a vault with a key file once the file is chosen there', async () => {
    await renderUnlock()
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'pw' } })

    fireEvent.click(advancedTrigger())
    fireEvent.click(await screen.findByRole('button', { name: 'Browse' }))
    await screen.findByText('my.key')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() =>
      expect(notvex.vault.open).toHaveBeenCalledExactlyOnceWith(VAULT, 'pw', KEY_FILE)
    )
  })
})
