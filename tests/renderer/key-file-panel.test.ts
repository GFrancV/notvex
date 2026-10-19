// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  configureKeyFile: vi.fn(),
  removeKeyFile: vi.fn(),
  selectKeyFile: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    vault: {
      configureKeyFile: ipc.configureKeyFile,
      removeKeyFile: ipc.removeKeyFile,
      selectKeyFile: ipc.selectKeyFile
    }
  }
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { toast } = await import('sonner')
const { KeyFilePanel } = await import('@/components/settings/KeyFilePanel')

const MNEMONIC = 'one two three four five six seven eight nine ten eleven twelve'
const KEY = new Uint8Array([1, 2, 3])
const onBack = vi.fn()
const onLockChange = vi.fn()
const onHasKeyFileChange = vi.fn()

const back = (): HTMLElement => screen.getByRole('button', { name: 'Security' })

function renderAdd(): void {
  render(
    createElement(KeyFilePanel, {
      mode: { kind: 'add', contents: KEY, filename: 'vault.nvxkey', sizeBytes: KEY.byteLength },
      onBack,
      onLockChange,
      onHasKeyFileChange
    })
  )
}

async function activate(): Promise<void> {
  renderAdd()
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'my password 123' }
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('KeyFilePanel: adding a key file', () => {
  it('shows the consequences and asks for the password in a single step', () => {
    renderAdd()

    expect(screen.getByRole('alert').textContent).toMatch(/recovery codes will be invalidated/i)
    // Shown in the same file field as the remove step, already filled in and still replaceable.
    expect(screen.getByText('vault.nvxkey')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear key file' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Current password'))
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('cannot be activated once the file is cleared', () => {
    renderAdd()
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'my password 123' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear key file' }))

    expect(screen.getByRole('button', { name: 'Activate' }).hasAttribute('disabled')).toBe(true)
  })

  it('activates the chosen file with the password', async () => {
    ipc.configureKeyFile.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    await activate()

    expect(ipc.configureKeyFile).toHaveBeenCalledWith('my password 123', KEY)
    expect(onHasKeyFileChange).toHaveBeenCalledWith(true)
  })
})

// Main re-keys the vault before the new mnemonic reaches the panel, so leaving it from submit
// until the new recovery key is confirmed would lose that key for good.
describe('KeyFilePanel: locking while the recovery key is at stake', () => {
  it('stays locked from activation until the new recovery key is confirmed', async () => {
    ipc.configureKeyFile.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    await activate()

    expect(onLockChange).toHaveBeenLastCalledWith(true)
    await screen.findByRole('heading', { name: 'Save your new recovery key' })
    expect(back().hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByLabelText(/i've saved my new recovery key/i))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onLockChange).toHaveBeenLastCalledWith(false)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('unlocks when the activation call itself rejects', async () => {
    ipc.configureKeyFile.mockRejectedValue(new Error('IPC gone'))
    await activate()

    expect(onLockChange.mock.calls).toEqual([[true], [false]])
    expect(screen.getByText(/something went wrong/i)).toBeTruthy()
    expect(back().hasAttribute('disabled')).toBe(false)
  })

  it('unlocks and shows the error when activation fails', async () => {
    ipc.configureKeyFile.mockResolvedValue({ success: false, error: 'Incorrect password' })
    await activate()

    expect(onLockChange.mock.calls).toEqual([[true], [false]])
    expect(onHasKeyFileChange).not.toHaveBeenCalled()
    expect(screen.getByText('Incorrect password')).toBeTruthy()
    expect(back().hasAttribute('disabled')).toBe(false)
  })
})

describe('KeyFilePanel: removing the key file', () => {
  function renderRemove(): void {
    render(
      createElement(KeyFilePanel, {
        mode: { kind: 'remove' },
        onBack,
        onLockChange,
        onHasKeyFileChange
      })
    )
  }

  it('puts focus on choosing the current key file when it opens', () => {
    renderRemove()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Browse' }))
  })

  it('needs both the current key file and the password, then stays locked until confirmed', async () => {
    ipc.selectKeyFile.mockResolvedValue({
      success: true,
      data: { contents: KEY, filename: 'vault.nvxkey', sizeBytes: 3 }
    })
    ipc.removeKeyFile.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    renderRemove()
    const remove = (): HTMLElement => screen.getByRole('button', { name: 'Remove' })

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'my password 123' }
    })
    expect(remove().hasAttribute('disabled')).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    })
    expect(remove().hasAttribute('disabled')).toBe(false)

    await act(async () => {
      fireEvent.click(remove())
    })
    expect(ipc.removeKeyFile).toHaveBeenCalledWith('my password 123', KEY)
    expect(onHasKeyFileChange).toHaveBeenCalledWith(false)
    expect(onLockChange).toHaveBeenLastCalledWith(true)
    await screen.findByRole('heading', { name: 'Save your new recovery key' })
    expect(back().hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByLabelText(/i've saved my new recovery key/i))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onLockChange).toHaveBeenLastCalledWith(false)
  })

  it('reports a key file that could not be chosen and keeps waiting for one', async () => {
    ipc.selectKeyFile.mockResolvedValue({ success: false, error: 'The selected key file is empty' })
    renderRemove()
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'my password 123' }
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    })

    expect(toast.error).toHaveBeenCalledWith('The selected key file is empty')
    expect(screen.getByRole('button', { name: 'Remove' }).hasAttribute('disabled')).toBe(true)
  })
})
