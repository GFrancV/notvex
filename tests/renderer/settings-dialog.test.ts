// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  getHasKeyFile: vi.fn(),
  openBackupsFolder: vi.fn(),
  exportAll: vi.fn(),
  openLogsFolder: vi.fn(),
  clearLogs: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    vault: { getHasKeyFile: ipc.getHasKeyFile, openBackupsFolder: ipc.openBackupsFolder },
    notes: { exportAll: ipc.exportAll },
    log: { openFolder: ipc.openLogsFolder, clear: ipc.clearLogs }
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
const { useVaultStore } = await import('@/store/vault.store')

const setPref = vi.fn(async () => undefined)
const onOpenChange = vi.fn()

async function renderDialog(): Promise<void> {
  await act(async () => {
    render(createElement(SettingsDialog, { open: true, onOpenChange }))
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
      'Vault & Data',
      'Diagnostics'
    ])
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

  it('runs a Vault & Data action', async () => {
    await renderDialog()
    fireEvent.mouseDown(tab('Vault & Data'))

    fireEvent.click(screen.getByRole('button', { name: 'Open backups folder' }))

    expect(ipc.openBackupsFolder).toHaveBeenCalledOnce()
  })

  it('warns about plaintext before exporting, on top of the settings', async () => {
    await renderDialog()
    fireEvent.mouseDown(tab('Vault & Data'))

    fireEvent.click(screen.getByRole('button', { name: 'Export all notes…' }))

    expect(screen.getByRole('heading', { name: 'Export all notes' })).toBeTruthy()
    expect(ipc.exportAll).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('stays open when the export warning is cancelled', async () => {
    await renderDialog()
    fireEvent.mouseDown(tab('Vault & Data'))
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
    expect(screen.getByLabelText('Current password')).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Security' }))

    expect(screen.getByRole('tabpanel').textContent).toMatch(/auto-lock/i)
  })

  it('opens key file management as a subpage', async () => {
    await renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /manage/i }))

    expect(currentCrumb()?.textContent).toBe('Key file')
    expect(screen.getByRole('button', { name: /generate key file/i })).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
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
