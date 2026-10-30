// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Security panel on its own: the dialog around it is covered by settings-dialog.test.ts, and
// leaving it out keeps these full add/remove flows well inside the test timeout.

const ipc = vi.hoisted(() => ({
  getHasKeyFile: vi.fn(),
  generateKeyFile: vi.fn(),
  selectKeyFile: vi.fn(),
  configureKeyFile: vi.fn(),
  removeKeyFile: vi.fn(),
  confirmRecoverySaved: vi.fn(() => Promise.resolve({ success: true, data: null }))
}))

const prefsIpc = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))

vi.mock('@/lib/ipc', () => ({ notvex: { vault: ipc, prefs: prefsIpc } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { toast } = await import('sonner')
const { SecurityPanel } = await import('@/components/settings/SecurityPanel')
const { usePrefsStore } = await import('@/store/prefs.store')

const MNEMONIC = 'one two three four five six seven eight nine ten eleven twelve'
const KEY = new Uint8Array([1, 2, 3])
const onLockChange = vi.fn()

async function renderPanel(): Promise<void> {
  await act(async () => {
    render(createElement(SecurityPanel, { onLockChange }))
  })
}

async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

async function confirmWithPassword(submit: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'my password 123' }
  })
  await click(submit)
  fireEvent.click(screen.getByLabelText('Recovery key saved somewhere safe'))
  await click('Done')
}

beforeEach(() => {
  ipc.getHasKeyFile.mockResolvedValue({ success: true, data: false })
  ipc.configureKeyFile.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
  ipc.removeKeyFile.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SecurityPanel: the key file row', () => {
  it('adds an existing file and hands focus back to that button on the way out', async () => {
    ipc.selectKeyFile.mockResolvedValue({
      success: true,
      data: { contents: KEY, filename: 'k.bin', sizeBytes: 3 }
    })
    await renderPanel()

    await click('Use existing…')

    expect(screen.getByText('k.bin')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Security' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Use existing…' }))
  })

  it('shows the key file as configured once one is added', async () => {
    ipc.generateKeyFile.mockResolvedValue({
      success: true,
      data: { contents: KEY, filename: 'vault.nvxkey' }
    })
    await renderPanel()

    await click('Generate…')
    await confirmWithPassword('Activate')

    expect(screen.getByText('Configured')).toBeTruthy()
    // The button that opened the flow is gone, so focus lands on the one that replaced it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove…' }))
  })

  it('shows the key file as not configured once it is removed', async () => {
    ipc.getHasKeyFile.mockResolvedValue({ success: true, data: true })
    ipc.selectKeyFile.mockResolvedValue({
      success: true,
      data: { contents: KEY, filename: 'vault.nvxkey', sizeBytes: 3 }
    })
    await renderPanel()

    await click('Remove…')
    await click('Browse')
    await confirmWithPassword('Remove')

    expect(screen.getByText('Not configured')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Generate…' }))
  })

  it.each([
    ['Use existing…', ipc.selectKeyFile],
    ['Generate…', ipc.generateKeyFile]
  ])('reports a failed "%s" and stays on Security', async (button, call) => {
    call.mockResolvedValue({ success: false, error: 'The selected key file is empty' })
    await renderPanel()

    await click(button)

    expect(toast.error).toHaveBeenCalledWith('The selected key file is empty')
    expect(screen.queryByText('Add key file')).toBeNull()
  })

  // Main caps the contents at 1MB, so only sizeBytes tells a larger file apart.
  it.each([
    [2_000_000, true],
    [1_048_577, true],
    [1_048_576, false],
    [3, false]
  ])('warns about the 1 MB cap for an existing file of %i bytes: %s', async (sizeBytes, warns) => {
    ipc.selectKeyFile.mockResolvedValue({
      success: true,
      data: { contents: KEY, filename: 'k.bin', sizeBytes }
    })
    await renderPanel()

    await click('Use existing…')

    expect(screen.queryByText(/only the first 1 MB will be used/i) !== null).toBe(warns)
  })

  it('stays silent when the file dialog is cancelled', async () => {
    ipc.selectKeyFile.mockResolvedValue({ success: true, data: null })
    await renderPanel()

    await click('Use existing…')

    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.queryByText('Add key file')).toBeNull()
  })
})

describe('SecurityPanel: clear when locked', () => {
  afterEach(() => {
    usePrefsStore.setState({ clearClipboardOnLock: true })
  })

  it('shows a saved off once the prefs load', async () => {
    prefsIpc.get.mockResolvedValue({
      success: true,
      data: { ...usePrefsStore.getState(), clearClipboardOnLock: false }
    })
    await usePrefsStore.getState().load()
    await renderPanel()

    const checkbox = screen.getByRole('checkbox', { name: 'Clear when locked' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })

  it('is on by default and saves the change when turned off', async () => {
    await renderPanel()
    const checkbox = screen.getByRole('checkbox', { name: 'Clear when locked' })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      fireEvent.click(checkbox)
    })

    expect(prefsIpc.set).toHaveBeenCalledExactlyOnceWith('clearClipboardOnLock', false)
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })
})
