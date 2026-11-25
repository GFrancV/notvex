// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Security panel on its own: the dialog around it is covered by settings-dialog.test.ts, and
// leaving it out keeps these full add/remove flows well inside the test timeout.

const ipc = vi.hoisted(() => ({
  getHasKeyFile: vi.fn(),
  getKdfLevel: vi.fn(),
  changeKdfLevel: vi.fn(),
  measureKdfLevel: vi.fn(() => new Promise(() => undefined)),
  generateKeyFile: vi.fn(),
  selectKeyFile: vi.fn(),
  configureKeyFile: vi.fn(),
  removeKeyFile: vi.fn(),
  confirmRecoverySaved: vi.fn(() => Promise.resolve({ success: true, data: null }))
}))

const prefsIpc = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
const notvex = vi.hoisted(() => ({
  vault: ipc,
  prefs: prefsIpc,
  shell: { openExternal: vi.fn() },
  platform: 'win32'
}))

vi.mock('@/lib/ipc', () => ({ notvex }))
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
  ipc.getKdfLevel.mockResolvedValue({ success: true, data: { id: 4, memoryMiB: 256, passes: 3 } })
  ipc.configureKeyFile.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
  ipc.removeKeyFile.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
  prefsIpc.set.mockResolvedValue({ success: true, data: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  notvex.platform = 'win32'
})

describe('SecurityPanel: the encryption section', () => {
  it('shows the key derivation level as a badge on its label, without "Current level"', async () => {
    await renderPanel()

    expect(screen.getByText('Key derivation').parentElement?.textContent).toBe(
      'Key derivation256 MiB'
    )
    expect(screen.getByText(/How much memory and time/).textContent).not.toContain('256 MiB')
    expect(screen.queryByText('Current level')).toBeNull()
  })

  it('shows the vault level, including one outside the four, and offers to change it', async () => {
    await renderPanel()

    expect(screen.getByText('Encryption')).toBeTruthy()
    expect(screen.getByText('256 MiB')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change…' })).toBeTruthy()
    cleanup()

    ipc.getKdfLevel.mockResolvedValue({ success: true, data: { id: 10, memoryMiB: 32, passes: 2 } })
    await renderPanel()

    expect(screen.getByText('32 MiB, 2 passes')).toBeTruthy()
  })

  it('keeps Continue disabled until a level different from the current one is chosen', async () => {
    ipc.getKdfLevel.mockResolvedValue({ success: true, data: { id: 10, memoryMiB: 32, passes: 2 } })
    await renderPanel()

    await click('Change…')
    const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^128 MiB/ }))
    })

    expect(next.disabled).toBe(false)
  })

  it('starts a level change with the current level chosen and Continue disabled', async () => {
    await renderPanel()

    await click('Change…')

    const checked = screen
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('aria-checked') === 'true')
    expect(checked).toEqual([screen.getByRole('radio', { name: /^256 MiB/ })])
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('disables Continue again when the current level is chosen back', async () => {
    await renderPanel()
    await click('Change…')
    const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^128 MiB/ }))
    })
    expect(next.disabled).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^256 MiB/ }))
    })
    expect(next.disabled).toBe(true)
  })

  it('asks for the password with a warning before changing the level, and sends the chosen level', async () => {
    ipc.changeKdfLevel.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    await renderPanel()
    await click('Change…')
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^128 MiB/ }))
    })

    await click('Continue')

    expect(screen.getByText(/Keep Notvex open/)).toBeTruthy()
    expect(screen.getByText('256 MiB')).toBeTruthy()
    expect(screen.getByText('128 MiB')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'my password 123' }
    })
    await click('Change level')

    expect(ipc.changeKdfLevel).toHaveBeenCalledExactlyOnceWith(5, 'my password 123', undefined)
  })

  it('locks the dialog, shows the new recovery key with a note on older copies, and shows the new level after confirming it', async () => {
    ipc.changeKdfLevel.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
    ipc.getKdfLevel
      .mockResolvedValueOnce({ success: true, data: { id: 4, memoryMiB: 256, passes: 3 } })
      .mockResolvedValue({ success: true, data: { id: 5, memoryMiB: 128, passes: 3 } })
    await renderPanel()
    await click('Change…')
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^128 MiB/ }))
    })
    await click('Continue')
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'my password 123' }
    })

    await click('Change level')

    expect(onLockChange).toHaveBeenCalledWith(true)
    expect(screen.getByText(/twelve/)).toBeTruthy()
    expect(screen.getByText(/older copy/i)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Recovery key saved somewhere safe'))
    await click('Done')

    expect(ipc.confirmRecoverySaved).toHaveBeenCalledOnce()
    expect(onLockChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByText('128 MiB')).toBeTruthy()
  })

  it('shows the error and stays on the confirmation when the change fails', async () => {
    ipc.changeKdfLevel.mockResolvedValue({
      success: false,
      error: "Couldn't change the level: Incorrect password or key file"
    })
    await renderPanel()
    await click('Change…')
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^128 MiB/ }))
    })
    await click('Continue')
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong one' } })

    await click('Change level')

    expect(
      screen.getByText("Couldn't change the level: Incorrect password or key file")
    ).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Change level' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  describe('on a vault with a key file', () => {
    async function reachConfirmWithPassword(): Promise<void> {
      ipc.getHasKeyFile.mockResolvedValue({ success: true, data: true })
      ipc.changeKdfLevel.mockResolvedValue({ success: true, data: { mnemonic: MNEMONIC } })
      await renderPanel()
      await click('Change…')
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: /^128 MiB/ }))
      })
      await click('Continue')
      fireEvent.change(screen.getByLabelText('Current password'), {
        target: { value: 'my password 123' }
      })
    }

    it('asks for the key file and sends nothing until one is chosen', async () => {
      await reachConfirmWithPassword()

      expect(screen.getByText('Key file')).toBeTruthy()
      await click('Change level')

      expect(screen.getByText('Choose your key file')).toBeTruthy()
      expect(ipc.changeKdfLevel).not.toHaveBeenCalled()
    })

    it('sends the chosen key file with the level and password', async () => {
      ipc.selectKeyFile.mockResolvedValue({
        success: true,
        data: { contents: KEY, filename: 'vault.nvxkey', sizeBytes: 3 }
      })
      await reachConfirmWithPassword()

      await click('Browse')
      await click('Change level')

      expect(ipc.changeKdfLevel).toHaveBeenCalledExactlyOnceWith(5, 'my password 123', KEY)
    })
  })
})

describe('SecurityPanel: the key file row', () => {
  it('shows a Configured badge on the key file label and offers Remove… when the vault has a key file', async () => {
    ipc.getHasKeyFile.mockResolvedValue({ success: true, data: true })
    await renderPanel()

    const labelLine = screen.getByText('Key file').parentElement
    expect(labelLine?.textContent).toContain('Configured')
    expect(screen.getAllByText('Configured')).toHaveLength(1)
    expect(screen.getByText(/A second factor/).textContent).not.toContain('Configured')
    expect(screen.getByRole('button', { name: 'Remove…' })).toBeTruthy()
  })

  it('shows no badge on the key file label and offers Generate… and Use existing… when the vault has none', async () => {
    await renderPanel()

    expect(screen.getByText('Key file').parentElement?.textContent).toBe('Key file')
    expect(screen.getByRole('button', { name: 'Generate…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use existing…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull()
  })

  it('shows neither a badge nor key file buttons while the state is pending', async () => {
    ipc.getHasKeyFile.mockReturnValue(new Promise(() => undefined))
    await renderPanel()

    expect(screen.getByText('Key file').parentElement?.textContent).toBe('Key file')
    expect(screen.getByText(/A second factor/)).toBeTruthy()
    for (const name of ['Generate…', 'Use existing…', 'Remove…']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('shows Configured and Remove… without ever showing Generate… or Use existing… once the state arrives with a key file', async () => {
    let answer: (r: { success: true; data: boolean }) => void = () => undefined
    ipc.getHasKeyFile.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const addButtonSeen = vi.fn()
    // Mutation records outlive the nodes they add, so a button that is added and removed within
    // one update is still seen.
    const watcher = new MutationObserver((records) => {
      for (const node of records.flatMap((r) => [...r.addedNodes])) {
        if (/Generate…|Use existing…/.test(node.textContent ?? '')) addButtonSeen()
      }
    })
    watcher.observe(document.body, { childList: true, subtree: true })
    await renderPanel()

    await act(async () => answer({ success: true, data: true }))
    watcher.disconnect()

    expect(screen.getByText('Configured')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove…' })).toBeTruthy()
    expect(addButtonSeen).not.toHaveBeenCalled()
  })

  it('leaves the key file row empty, without falling back to "Not configured", when the state cannot be read', async () => {
    ipc.getHasKeyFile.mockResolvedValue({ success: false, error: 'No vault is open' })
    await renderPanel()

    expect(screen.getByText('Key file').parentElement?.textContent).toBe('Key file')
    for (const name of ['Generate…', 'Use existing…', 'Remove…']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

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

    expect(screen.queryByText('Configured')).toBeNull()
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

describe('SecurityPanel: the privacy section', () => {
  it('hides the Privacy section and "Prevent screen capture" on Linux', async () => {
    notvex.platform = 'linux'
    await renderPanel()

    expect(screen.queryByText('Privacy')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Prevent screen capture' })).toBeNull()
  })

  it.each(['win32', 'darwin'])(
    'shows the Privacy section and "Prevent screen capture" on %s',
    async (platform) => {
      notvex.platform = platform
      await renderPanel()

      expect(screen.getByText('Privacy')).toBeTruthy()
      expect(screen.getByRole('checkbox', { name: 'Prevent screen capture' })).toBeTruthy()
    }
  )

  it('on Linux the remaining sections have no doubled separator', async () => {
    notvex.platform = 'linux'
    await renderPanel()

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual([
      'Auto-lock',
      'Clipboard',
      'Authentication',
      'Encryption',
      'Always-on protections'
    ])
    expect(document.querySelectorAll('[data-slot="separator"]')).toHaveLength(headings.length - 1)
  })
})
