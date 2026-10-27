// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  getHasKeyFile: vi.fn(),
  changePassword: vi.fn(),
  generateKeyFile: vi.fn(),
  openBackupsFolder: vi.fn(),
  exportAll: vi.fn(),
  openLogsFolder: vi.fn(),
  clearLogs: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    vault: {
      getHasKeyFile: ipc.getHasKeyFile,
      changePassword: ipc.changePassword,
      generateKeyFile: ipc.generateKeyFile,
      openBackupsFolder: ipc.openBackupsFolder
    },
    notes: { exportAll: ipc.exportAll },
    log: { openFolder: ipc.openLogsFolder, clear: ipc.clearLogs },
    app: { isDev: async () => ({ success: true, data: false }) },
    updater: { getCurrentVersion: async () => ({ success: true, data: '1.2.3' }) }
  }
}))
vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn()
  }
}))

const { SettingsDialog } = await import('@/components/settings-dialog')
const { toast } = await import('sonner')
const { usePrefsStore } = await import('@/store/prefs.store')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

const setPref = vi.fn(async () => undefined)
const onOpenChange = vi.fn()

async function renderDialog(initialTab?: 'about'): Promise<void> {
  await act(async () => {
    render(createElement(SettingsDialog, { open: true, onOpenChange, initialTab }))
  })
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name })
// The subpage title is the breadcrumb's current page.
const currentCrumb = (): Element | null => document.querySelector('[aria-current="page"]')

beforeEach(() => {
  ipc.getHasKeyFile.mockResolvedValue({ success: true, data: false })
  ipc.openBackupsFolder.mockResolvedValue({ success: true, data: null })
  ipc.openLogsFolder.mockResolvedValue({ success: true, data: null })
  ipc.clearLogs.mockResolvedValue({ success: true, data: null })
  usePrefsStore.setState({ setPref, lockOnMinimize: false, checkUpdatesOnStartup: true })
  useVaultStore.setState({ currentVaultPath: '/v/vault.nvx' })
  // The lock outlives the dialog, so a test left mid-step would lock the next one.
  useUiStore.setState({ settingsLocked: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsDialog', () => {
  it('opens on Security', async () => {
    await renderDialog()

    expect(tab('Security').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toMatch(/auto-lock/i)
  })

  it('names every section in a vertical tab list', async () => {
    await renderDialog()

    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Security',
      'Updates',
      'Vault & data',
      'Diagnostics',
      'About'
    ])
  })

  it('starts fresh on every open: the requested tab, no subpage left over', async () => {
    const props = { onOpenChange }
    const { rerender } = render(createElement(SettingsDialog, { ...props, open: true }))
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    expect(currentCrumb()).not.toBeNull()

    rerender(createElement(SettingsDialog, { ...props, open: false }))
    rerender(createElement(SettingsDialog, { ...props, open: true, initialTab: 'about' }))
    expect(tab('About').getAttribute('aria-selected')).toBe('true')

    rerender(createElement(SettingsDialog, { ...props, open: false }))
    rerender(createElement(SettingsDialog, { ...props, open: true }))
    expect(tab('Security').getAttribute('aria-selected')).toBe('true')
    expect(currentCrumb()).toBeNull()
  })

  it('asks main once whether a key file is configured, and shows it', async () => {
    ipc.getHasKeyFile.mockResolvedValue({ success: true, data: true })
    await renderDialog()

    expect(await screen.findByText('Configured')).toBeTruthy()
    expect(ipc.getHasKeyFile).toHaveBeenCalledOnce()
  })

  it('opens on About when asked to', async () => {
    await renderDialog('about')

    expect(tab('About').getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText('v1.2.3')).toBeTruthy()
  })

  it('switches sections with the arrow keys', async () => {
    await renderDialog()

    fireEvent.keyDown(tab('Security'), { key: 'ArrowDown' })

    // Radix moves focus to the next tab on a timeout, and focus is what activates it.
    await waitFor(() => expect(tab('Updates').getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('tabpanel').textContent).toMatch(/check for updates on startup/i)
  })

  it('switches sections on click', async () => {
    await renderDialog()

    // Radix tabs activate on mousedown, not click.
    fireEvent.mouseDown(tab('Updates'))

    expect(tab('Updates').getAttribute('aria-selected')).toBe('true')
  })

  it('saves a Security setting', async () => {
    await renderDialog()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Lock when minimized' }))

    expect(setPref).toHaveBeenCalledWith('lockOnMinimize', true)
  })

  it('saves the Updates setting', async () => {
    await renderDialog()
    fireEvent.mouseDown(tab('Updates'))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Check for updates on startup' }))

    expect(setPref).toHaveBeenCalledWith('checkUpdatesOnStartup', false)
  })

  it('runs a Vault & data action', async () => {
    await renderDialog()
    fireEvent.mouseDown(tab('Vault & data'))

    fireEvent.click(screen.getByRole('button', { name: 'Open backups folder' }))

    expect(ipc.openBackupsFolder).toHaveBeenCalledOnce()
  })

  it('warns about plaintext before exporting, on top of the settings', async () => {
    await renderDialog()
    fireEvent.mouseDown(tab('Vault & data'))

    fireEvent.click(screen.getByRole('button', { name: 'Export all notes…' }))

    expect(screen.getByRole('heading', { name: 'Export all notes' })).toBeTruthy()
    expect(ipc.exportAll).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  // A behavior spec, not a regression proof: jsdom can't reproduce the Radix outside-click that
  // dismissed Settings when the warning rendered beside DialogContent, so this passes either way.
  it('stays open when the export warning is cancelled', async () => {
    await renderDialog()
    fireEvent.mouseDown(tab('Vault & data'))
    fireEvent.click(screen.getByRole('button', { name: 'Export all notes…' }))

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Export all notes' })).toBeNull()
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('opens Change password as a subpage and goes back to Security', async () => {
    await renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    expect(currentCrumb()?.textContent).toBe('Change password')
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Security' }))

    expect(screen.getByRole('tabpanel').textContent).toMatch(/auto-lock/i)
  })

  it('adds a key file straight from its row and hands focus back on the way out', async () => {
    ipc.generateKeyFile.mockResolvedValue({
      success: true,
      data: { contents: new Uint8Array([1]), filename: 'vault.nvxkey' }
    })
    await renderDialog()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate…' }))
    })

    expect(currentCrumb()?.textContent).toBe('Add key file')
    expect(document.activeElement).toBe(screen.getByLabelText('Current password'))
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Security' }))

    // Back returns focus to the row that opened the subpage, not to the dialog root.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Generate…' }))
  })

  it('stays on Security when the key file dialog is cancelled', async () => {
    ipc.generateKeyFile.mockResolvedValue({ success: true, data: null })
    await renderDialog()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate…' }))
    })

    expect(currentCrumb()).toBeNull()
  })

  it('drops an open subpage when switching tabs', async () => {
    await renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    fireEvent.mouseDown(tab('Updates'))
    fireEvent.mouseDown(tab('Security'))

    expect(currentCrumb()).toBeNull()
    expect(screen.getByRole('tabpanel').textContent).toMatch(/auto-lock/i)
  })
})

// The lock's full lifecycle (mnemonic step, Done, failure) is in change-password-panel.test.ts;
// this checks the dialog honours it.
describe('SettingsDialog: a rekey in progress', () => {
  // Starts a password change whose IPC call never settles.
  async function startPasswordChange(): Promise<void> {
    ipc.changePassword.mockReturnValue(new Promise(() => {}))
    await renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old password 123' }
    })
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new password 456' }
    })
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'new password 456' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    await screen.findByRole('button', { name: /re-encrypting/i })
  }

  it('cannot be left while the vault is re-encrypting', async () => {
    await startPasswordChange()

    expect(screen.getByRole('button', { name: 'Security' }).hasAttribute('disabled')).toBe(true)
    for (const name of ['Updates', 'Vault & data', 'Diagnostics', 'About']) {
      expect(tab(name).hasAttribute('disabled')).toBe(true)
    }
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(currentCrumb()?.textContent).toBe('Change password')
    // Shared with Ctrl+L, which must wait too.
    expect(useUiStore.getState().settingsLocked).toBe(true)
  })
})

describe('SettingsDialog: Diagnostics', () => {
  async function openDiagnostics(): Promise<void> {
    await renderDialog()
    fireEvent.mouseDown(tab('Diagnostics'))
  }

  async function openClearDialog(): Promise<void> {
    await openDiagnostics()
    fireEvent.click(screen.getByRole('button', { name: 'Clear logs…' }))
    await screen.findByRole('heading', { name: 'Clear error logs?' })
  }

  it('opens the logs folder', async () => {
    await openDiagnostics()

    fireEvent.click(screen.getByRole('button', { name: 'Open logs folder' }))

    expect(ipc.openLogsFolder).toHaveBeenCalledOnce()
  })

  it('says so when the logs folder cannot be opened', async () => {
    ipc.openLogsFolder.mockResolvedValue({ success: false, error: 'Failed to open path' })
    await openDiagnostics()

    fireEvent.click(screen.getByRole('button', { name: 'Open logs folder' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't open the logs folder"))
  })

  it('asks for confirmation on top of the settings before clearing anything', async () => {
    await openClearDialog()

    expect(screen.getByText(/can't be undone/i)).toBeTruthy()
    expect(ipc.clearLogs).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  // Same limit as the export warning's cancel test: a behavior spec for the nested layout.
  it('leaves the logs and the settings alone when cancelled', async () => {
    await openClearDialog()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Clear error logs?' })).toBeNull()
    )
    expect(ipc.clearLogs).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('clears the logs once confirmed', async () => {
    await openClearDialog()

    fireEvent.click(screen.getByRole('button', { name: /^clear logs$/i }))

    await waitFor(() => expect(ipc.clearLogs).toHaveBeenCalledOnce())
    expect(toast.success).toHaveBeenCalledWith('Logs cleared')
  })

  it('can still be closed when the clear call itself rejects', async () => {
    ipc.clearLogs.mockRejectedValue(new Error('IPC gone'))
    await openClearDialog()

    fireEvent.click(screen.getByRole('button', { name: /^clear logs$/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't clear the logs"))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Clear error logs?' })).toBeNull()
    )
  })

  it('says so when clearing fails', async () => {
    ipc.clearLogs.mockResolvedValue({ success: false, error: 'EBUSY' })
    await openClearDialog()

    fireEvent.click(screen.getByRole('button', { name: /^clear logs$/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't clear the logs"))
  })
})
