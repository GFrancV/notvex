// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ generateKeyFile: vi.fn(), configureKeyFile: vi.fn() }))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    vault: { generateKeyFile: ipc.generateKeyFile, configureKeyFile: ipc.configureKeyFile }
  }
}))

const { KeyFilePanel } = await import('@/components/settings/KeyFilePanel')

const MNEMONIC = 'one two three four five six seven eight nine ten eleven twelve'
const onBack = vi.fn()
const onLockChange = vi.fn()
const onHasKeyFileChange = vi.fn()

const back = (): HTMLElement => screen.getByRole('button', { name: 'Security' })

async function activateGeneratedKeyFile(): Promise<void> {
  render(
    createElement(KeyFilePanel, { onBack, onLockChange, onHasKeyFileChange, hasKeyFile: false })
  )
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate key file/i }))
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'my password 123' }
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
  })
}

beforeEach(() => {
  ipc.generateKeyFile.mockResolvedValue({
    success: true,
    data: { contents: new Uint8Array([1, 2, 3]), filename: 'vault.nvxkey' }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Same stake as a password change: main re-keys before the new mnemonic reaches the panel.
describe('KeyFilePanel: locking while the recovery key is at stake', () => {
  it('stays locked from activation until the new recovery key is confirmed', async () => {
    ipc.configureKeyFile.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    await activateGeneratedKeyFile()

    expect(onLockChange).toHaveBeenLastCalledWith(true)
    expect(onHasKeyFileChange).toHaveBeenCalledWith(true)
    await screen.findByRole('heading', { name: 'Save your new recovery key' })
    expect(back().hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByLabelText(/i have saved my new recovery key/i))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onLockChange).toHaveBeenLastCalledWith(false)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('unlocks and shows the error when activation fails', async () => {
    ipc.configureKeyFile.mockResolvedValue({ success: false, error: 'Incorrect password' })
    await activateGeneratedKeyFile()

    expect(onLockChange.mock.calls).toEqual([[true], [false]])
    expect(onHasKeyFileChange).not.toHaveBeenCalled()
    expect(screen.getByText('Incorrect password')).toBeTruthy()
    expect(back().hasAttribute('disabled')).toBe(false)
  })
})
