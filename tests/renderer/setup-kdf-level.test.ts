// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    shell: { openExternal: vi.fn() },
    vault: { create, measureKdfLevel: vi.fn().mockReturnValue(new Promise(() => undefined)) }
  }
}))

const { Setup } = await import('@/views/setup')
const { useVaultStore } = await import('@/store/vault.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

beforeEach(() => {
  create.mockResolvedValue({ success: false, error: 'A vault already exists at this location.' })
  // Opened from the vault switcher: the password step comes first.
  useVaultStore.setState({ status: 'uninitialized', pendingNewVaultPath: '/vaults/new.nvx' })
  render(createElement(Setup), { wrapper: TooltipProvider })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Setup key derivation level', () => {
  it('creates the vault at the level chosen in the password step', async () => {
    fireEvent.change(screen.getByLabelText('Master password'), {
      target: { value: 'long enough password' }
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'long enough password' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))
    fireEvent.click(screen.getByRole('radio', { name: /^512 MiB/ }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create vault' }))
    })

    expect(create).toHaveBeenCalledExactlyOnceWith('/vaults/new.nvx', 'long enough password', 2)
  })

  it('shows a creation error, stays on the step and keeps the chosen level', async () => {
    const refusal = "Couldn't create the vault: this computer doesn't have enough memory for it"
    create.mockResolvedValue({ success: false, error: refusal })
    fireEvent.change(screen.getByLabelText('Master password'), {
      target: { value: 'long enough password' }
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'long enough password' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))
    fireEvent.click(screen.getByRole('radio', { name: /^512 MiB/ }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create vault' }))
    })

    expect(screen.getByRole('alert').textContent).toBe(refusal)
    expect(screen.queryByText('Save your recovery key')).toBeNull()
    expect(screen.getByRole('radio', { name: /^512 MiB/ }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })
})
