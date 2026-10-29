// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    vault: { create }
  }
}))

const { Setup } = await import('@/views/setup')
const { useVaultStore } = await import('@/store/vault.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

const password = (): HTMLElement => screen.getByLabelText('Master password')
const confirm = (): HTMLElement => screen.getByLabelText('Confirm password')
const errors = (): string[] => screen.queryAllByRole('alert').map((e) => e.textContent ?? '')

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

describe('Setup password step', () => {
  it('says nothing until a field is left', () => {
    fireEvent.change(password(), { target: { value: 'short' } })

    expect(errors()).toEqual([])
  })

  it('checks each field when it is left', () => {
    fireEvent.change(password(), { target: { value: 'short' } })
    fireEvent.blur(password())
    expect(errors()).toEqual(['Use at least 12 characters'])

    fireEvent.change(password(), { target: { value: 'long enough password' } })
    fireEvent.change(confirm(), { target: { value: 'something else' } })
    fireEvent.blur(confirm())
    expect(errors()).toEqual(["Passwords don't match"])
  })

  it('shows every error on submit and creates nothing; the button stays usable', async () => {
    const button = screen.getByRole('button', { name: 'Create vault' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)

    await act(async () => {
      fireEvent.click(button)
    })

    expect(errors()).toEqual(['Use at least 12 characters'])
    expect(create).not.toHaveBeenCalled()
  })

  it('shows what main refused at the foot of the form', async () => {
    fireEvent.change(password(), { target: { value: 'long enough password' } })
    fireEvent.change(confirm(), { target: { value: 'long enough password' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create vault' }))
    })

    expect(create).toHaveBeenCalledOnce()
    expect(errors()).toEqual(['A vault already exists at this location.'])
  })
})
