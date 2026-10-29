// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  getHasKeyFile: vi.fn(),
  rotateCredentials: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: { vault: { getHasKeyFile: ipc.getHasKeyFile, rotateCredentials: ipc.rotateCredentials } }
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { PostRecoveryReset } = await import('@/views/post-recovery-reset')

const newPassword = (): HTMLElement => screen.getByLabelText('New password')
const confirm = (): HTMLElement => screen.getByLabelText('Confirm new password')
const errors = (): string[] => screen.queryAllByRole('alert').map((e) => e.textContent ?? '')

beforeEach(async () => {
  ipc.getHasKeyFile.mockResolvedValue({ success: true, data: false })
  ipc.rotateCredentials.mockResolvedValue({ success: false, error: 'Vault is locked' })
  await act(async () => {
    render(createElement(PostRecoveryReset))
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  })
}

describe('PostRecoveryReset password', () => {
  it('accepts 12 characters even when the strength bar says weak', async () => {
    fireEvent.change(newPassword(), { target: { value: 'aaaaaaaaaaaa' } })
    fireEvent.change(confirm(), { target: { value: 'aaaaaaaaaaaa' } })

    await submit()

    expect(ipc.rotateCredentials).toHaveBeenCalledWith('aaaaaaaaaaaa')
  })

  it('checks the length when the field is left', () => {
    fireEvent.change(newPassword(), { target: { value: 'short' } })
    fireEvent.blur(newPassword())

    expect(errors()).toEqual(['Use at least 12 characters'])
  })

  it('shows every error on submit and sends nothing', async () => {
    expect(
      (screen.getByRole('button', { name: 'Set new password' }) as HTMLButtonElement).disabled
    ).toBe(false)

    await submit()

    expect(errors()).toEqual(['Use at least 12 characters'])
    expect(ipc.rotateCredentials).not.toHaveBeenCalled()
  })

  it('shows what main refused at the foot of the form', async () => {
    fireEvent.change(newPassword(), { target: { value: 'long enough password' } })
    fireEvent.change(confirm(), { target: { value: 'long enough password' } })

    await submit()

    expect(errors()).toEqual(['Vault is locked'])
  })
})
