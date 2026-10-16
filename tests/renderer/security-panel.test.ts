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
  removeKeyFile: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({ notvex: { vault: ipc } }))

const { SecurityPanel } = await import('@/components/settings/SecurityPanel')

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
  fireEvent.click(screen.getByLabelText(/i have saved my new recovery key/i))
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
})
