// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const NEW_VAULT = '/vaults/new.nvx'
const EXISTING_VAULT = '/vaults/existing.nvx'

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    vault: {
      chooseFile: vi.fn(),
      hasVault: vi.fn(),
      create: vi.fn()
    }
  }
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { toast } = await import('sonner')
const { notvex } = await import('@/lib/ipc')
const { Setup } = await import('@/views/setup')
const { useVaultStore } = await import('@/store/vault.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

beforeEach(() => {
  // First run: no vault was chosen yet, so Setup opens on its start screen.
  useVaultStore.setState({ status: 'uninitialized', pendingNewVaultPath: null })
  render(createElement(Setup), { wrapper: TooltipProvider })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Setup start screen', () => {
  it('offers creating and opening as two separate actions', () => {
    expect(screen.getByText('Create or open a vault')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create new vault…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open existing vault…' })).toBeTruthy()
  })

  it('creating a vault picks the location and goes to the password step', async () => {
    vi.mocked(notvex.vault.chooseFile).mockResolvedValue({ success: true, data: NEW_VAULT })
    vi.mocked(notvex.vault.hasVault).mockResolvedValue({ success: true, data: 'missing' })

    fireEvent.click(screen.getByRole('button', { name: 'Create new vault…' }))

    expect(await screen.findByLabelText('Master password')).toBeTruthy()
    expect(notvex.vault.chooseFile).toHaveBeenCalledExactlyOnceWith('new')
  })

  it('refuses a file that is already a vault with a lasting error and no password step', async () => {
    vi.mocked(notvex.vault.chooseFile).mockResolvedValue({ success: true, data: EXISTING_VAULT })
    vi.mocked(notvex.vault.hasVault).mockResolvedValue({ success: true, data: 'usable' })

    fireEvent.click(screen.getByRole('button', { name: 'Create new vault…' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        'That file is already a Notvex vault',
        expect.objectContaining({
          duration: Infinity,
          action: expect.objectContaining({ label: 'Open it' })
        })
      )
    )
    expect(screen.queryByLabelText('Master password')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create new vault…' })).toBeTruthy()
  })

  it('"Open it" on the refusal sends that vault to its unlock form', async () => {
    vi.mocked(notvex.vault.chooseFile).mockResolvedValue({ success: true, data: EXISTING_VAULT })
    vi.mocked(notvex.vault.hasVault).mockResolvedValue({ success: true, data: 'usable' })
    fireEvent.click(screen.getByRole('button', { name: 'Create new vault…' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const options = vi.mocked(toast.error).mock.calls[0][1] as {
      action: { label: string; onClick: () => void }
    }

    act(() => options.action.onClick())

    expect(useVaultStore.getState().status).toBe('locked')
    expect(useVaultStore.getState().pendingOpenVaultPath).toBe(EXISTING_VAULT)
  })

  it('opening an existing vault sends the picked one to its unlock form', async () => {
    vi.mocked(notvex.vault.chooseFile).mockResolvedValue({ success: true, data: EXISTING_VAULT })
    vi.mocked(notvex.vault.hasVault).mockResolvedValue({ success: true, data: 'usable' })

    fireEvent.click(screen.getByRole('button', { name: 'Open existing vault…' }))

    await waitFor(() => expect(useVaultStore.getState().status).toBe('locked'))
    expect(useVaultStore.getState().pendingOpenVaultPath).toBe(EXISTING_VAULT)
    expect(notvex.vault.chooseFile).toHaveBeenCalledExactlyOnceWith('existing')
  })
})
