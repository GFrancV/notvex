// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  getHasKeyFile: vi.fn(),
  changePassword: vi.fn(),
  confirmRecoverySaved: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    vault: {
      getHasKeyFile: ipc.getHasKeyFile,
      changePassword: ipc.changePassword,
      confirmRecoverySaved: ipc.confirmRecoverySaved
    }
  }
}))

const { ChangePasswordPanel } = await import('@/components/settings/ChangePasswordPanel')

const MNEMONIC = 'one two three four five six seven eight nine ten eleven twelve'
const onBack = vi.fn()
const onLockChange = vi.fn()

const back = (): HTMLElement => screen.getByRole('button', { name: 'Security' })

async function submitValidForm(): Promise<void> {
  await act(async () => {
    render(createElement(ChangePasswordPanel, { onBack, onLockChange }))
  })
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'old password 123' }
  })
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'new password 456' }
  })
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'new password 456' }
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
  })
}

beforeEach(() => {
  ipc.getHasKeyFile.mockResolvedValue({ success: true, data: false })
  ipc.confirmRecoverySaved.mockResolvedValue({ success: true, data: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ChangePasswordPanel', () => {
  it('puts focus on the first field when it opens', async () => {
    await act(async () => {
      render(createElement(ChangePasswordPanel, { onBack, onLockChange }))
    })

    expect(document.activeElement).toBe(screen.getByLabelText('Current password'))
  })
})

// Main re-keys the vault before the mnemonic comes back, so leaving the panel from submit until
// the new recovery key is confirmed would lose that key for good.
describe('ChangePasswordPanel: locking while the recovery key is at stake', () => {
  it('stays locked from submit until the new recovery key is confirmed', async () => {
    ipc.changePassword.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    await submitValidForm()

    expect(ipc.changePassword).toHaveBeenCalledWith(
      'old password 123',
      'new password 456',
      undefined
    )
    expect(onLockChange).toHaveBeenLastCalledWith(true)
    await screen.findByRole('heading', { name: 'Save your new recovery key' })
    expect(back().hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Done' }).hasAttribute('disabled')).toBe(true)
    expect(ipc.confirmRecoverySaved).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText(/i've saved my new recovery key/i))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(ipc.confirmRecoverySaved).toHaveBeenCalledOnce()
    expect(onLockChange).toHaveBeenLastCalledWith(false)
    expect(onBack).toHaveBeenCalledOnce()
  })

  // main keeps the vault flagged, so the next unlock warns instead
  it('still leaves the step when confirming the recovery key fails', async () => {
    ipc.changePassword.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    ipc.confirmRecoverySaved.mockRejectedValue(new Error('IPC gone'))
    await submitValidForm()

    await screen.findByRole('heading', { name: 'Save your new recovery key' })
    fireEvent.click(screen.getByLabelText(/i've saved my new recovery key/i))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onLockChange).toHaveBeenLastCalledWith(false)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('unlocks when the change call itself rejects', async () => {
    ipc.changePassword.mockRejectedValue(new Error('IPC gone'))
    await submitValidForm()

    expect(onLockChange.mock.calls).toEqual([[true], [false]])
    expect(screen.getByText(/something went wrong/i)).toBeTruthy()
    expect(back().hasAttribute('disabled')).toBe(false)
  })

  it('unlocks and shows the error when the change fails', async () => {
    ipc.changePassword.mockResolvedValue({ success: false, error: 'Incorrect password' })
    await submitValidForm()

    expect(onLockChange.mock.calls).toEqual([[true], [false]])
    expect(screen.getByText('Incorrect password')).toBeTruthy()
    expect(back().hasAttribute('disabled')).toBe(false)
  })
})
