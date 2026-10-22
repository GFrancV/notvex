// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MNEMONIC = Array.from({ length: 24 }, (_, i) => `word${i}`).join(' ')

const ipc = vi.hoisted(() => ({
  recoveryUnconfirmed: vi.fn(),
  getHasKeyFile: vi.fn(),
  regenerateRecoveryKey: vi.fn(),
  confirmRecoverySaved: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({ notvex: { vault: ipc } }))

const { RecoveryKeyUnconfirmedDialog } =
  await import('@/components/dialogs/RecoveryKeyUnconfirmedDialog')
const { useUiStore } = await import('@/store/ui.store')

const TITLE = /recovery key was never confirmed/i

async function renderDialog(): Promise<void> {
  await act(async () => {
    render(createElement(RecoveryKeyUnconfirmedDialog))
  })
}

async function click(name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

async function generate(password = 'my password 123'): Promise<void> {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  await click('Generate new recovery key')
}

beforeEach(() => {
  ipc.recoveryUnconfirmed.mockResolvedValue({ success: true, data: true })
  ipc.getHasKeyFile.mockResolvedValue({ success: true, data: false })
  ipc.regenerateRecoveryKey.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
  ipc.confirmRecoverySaved.mockResolvedValue({ success: true, data: null })
})

afterEach(() => {
  cleanup()
  useUiStore.setState({ settingsLocked: false })
  vi.clearAllMocks()
})

describe('RecoveryKeyUnconfirmedDialog', () => {
  it('stays hidden when the vault has no unconfirmed key', async () => {
    ipc.recoveryUnconfirmed.mockResolvedValue({ success: true, data: false })
    await renderDialog()

    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('warns after unlock when the last key was never confirmed', async () => {
    await renderDialog()

    expect(screen.getByText(TITLE)).toBeTruthy()
  })

  it('generates a new key, shows it, and confirms it once saved', async () => {
    await renderDialog()

    await generate()

    expect(ipc.regenerateRecoveryKey).toHaveBeenCalledExactlyOnceWith('my password 123', undefined)
    expect(screen.getByText('word23')).toBeTruthy()
    expect(ipc.confirmRecoverySaved).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText(/i've saved my new recovery key/i))
    await click('Done')

    expect(ipc.confirmRecoverySaved).toHaveBeenCalledOnce()
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(useUiStore.getState().settingsLocked).toBe(false)
  })

  it('cannot be left while the new words are on screen', async () => {
    await renderDialog()
    await generate()

    expect(useUiStore.getState().settingsLocked).toBe(true)
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.getByText('word23')).toBeTruthy()
  })

  it('shows a wrong password and stays on the form', async () => {
    ipc.regenerateRecoveryKey.mockResolvedValue({
      success: false,
      error: 'Current password is incorrect'
    })
    await renderDialog()

    await generate('wrong')

    expect(screen.getByText('Current password is incorrect')).toBeTruthy()
    expect(useUiStore.getState().settingsLocked).toBe(false)
  })

  it('a rejected call releases the lock and can be left again', async () => {
    ipc.regenerateRecoveryKey.mockRejectedValue(new Error('ipc gone'))
    await renderDialog()

    await generate()

    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy()
    expect(useUiStore.getState().settingsLocked).toBe(false)
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('asks for the key file when the vault has one', async () => {
    ipc.getHasKeyFile.mockResolvedValue({ success: true, data: true })
    await renderDialog()

    expect(screen.getByText('Key file')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Generate new recovery key' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it('"Later" closes it without changing anything', async () => {
    await renderDialog()

    await click('Later')

    expect(screen.queryByText(TITLE)).toBeNull()
    expect(ipc.regenerateRecoveryKey).not.toHaveBeenCalled()
    expect(ipc.confirmRecoverySaved).not.toHaveBeenCalled()
  })
})
