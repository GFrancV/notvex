// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  import: vi.fn(),
  exportAll: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: { notes: { import: ipc.import, exportAll: ipc.exportAll } }
}))
vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-1'),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn()
  }
}))

const { VaultMenuGroup } = await import('@/components/settings/VaultMenuGroup')
const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } =
  await import('@/components/ui/dropdown-menu')
const { useVaultStore } = await import('@/store/vault.store')
const { toast } = await import('sonner')

const refreshAll = vi.fn<() => Promise<void>>()
const onExportAll = vi.fn()

function renderMenu(): void {
  render(
    createElement(
      DropdownMenu,
      { open: true },
      createElement(DropdownMenuTrigger, null, 'Settings'),
      createElement(
        DropdownMenuContent,
        null,
        createElement(VaultMenuGroup, { vaultPath: '/v/vault.nvx', onExportAll })
      )
    )
  )
}

async function click(name: string): Promise<void> {
  const item = await screen.findByRole('menuitem', { name })
  await act(async () => {
    fireEvent.click(item)
  })
}

beforeEach(() => {
  // Radix's own auto-focus registers as a focus outside the menu in jsdom; see note-list-sort.
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
  refreshAll.mockResolvedValue(undefined)
  useVaultStore.setState({ refreshAll })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('VaultMenuGroup: Import Markdown…', () => {
  it('refreshes the notes and reports a clean import', async () => {
    ipc.import.mockResolvedValue({
      success: true,
      data: { imported: 2, skipped: [], droppedTags: [] }
    })
    renderMenu()

    await click('Import Markdown…')

    expect(refreshAll).toHaveBeenCalledOnce()
    expect(toast.success).toHaveBeenCalledWith('Imported 2 notes', { id: 'toast-1' })
  })

  it('does not refresh when nothing was imported, and lists why', async () => {
    ipc.import.mockResolvedValue({
      success: true,
      data: {
        imported: 0,
        skipped: [{ file: 'big.md', reason: 'larger than 5 MB' }],
        droppedTags: []
      }
    })
    renderMenu()

    await click('Import Markdown…')

    expect(refreshAll).not.toHaveBeenCalled()
    const [message, options] = vi.mocked(toast.warning).mock.calls[0]
    expect(message).toBe('Imported 0 notes')
    render(createElement('div', null, (options as { description: ReactNode }).description))
    expect(screen.getByText('big.md: larger than 5 MB')).not.toBeNull()
  })

  it('dismisses the progress toast when the file dialog is canceled', async () => {
    ipc.import.mockResolvedValue({ success: true, data: null })
    renderMenu()

    await click('Import Markdown…')

    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
    expect(refreshAll).not.toHaveBeenCalled()
  })

  it('shows the error when the import fails', async () => {
    ipc.import.mockResolvedValue({ success: false, error: 'Vault is locked' })
    renderMenu()

    await click('Import Markdown…')

    expect(toast.error).toHaveBeenCalledWith('Vault is locked', { id: 'toast-1' })
  })

  it('still reports the import if refreshing the list fails afterwards', async () => {
    ipc.import.mockResolvedValue({
      success: true,
      data: { imported: 1, skipped: [], droppedTags: [] }
    })
    refreshAll.mockRejectedValue(new Error('Vault is locked'))
    renderMenu()

    await click('Import Markdown…')

    expect(toast.success).toHaveBeenCalledWith('Imported 1 note', { id: 'toast-1' })
  })
})

describe('VaultMenuGroup: Export all notes…', () => {
  it('asks the caller to show the warning instead of exporting straight away', async () => {
    renderMenu()

    await click('Export all notes…')

    expect(onExportAll).toHaveBeenCalledOnce()
    expect(ipc.exportAll).not.toHaveBeenCalled()
  })
})
