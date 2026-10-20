// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Note } from '@shared/types'

const ipc = vi.hoisted(() => ({
  get: vi.fn(),
  export: vi.fn()
}))

// CodeMirror carries no weight for the menu path and is expensive in jsdom.
vi.mock('@uiw/react-codemirror', () => ({ default: (): null => null }))
vi.mock('@/lib/pending-save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pending-save')>()),
  flushAllPending: vi.fn(async () => {})
}))
vi.mock('@/lib/ipc', () => {
  const ok = (): Promise<{ success: true; data: [] }> =>
    Promise.resolve({ success: true, data: [] })
  return {
    notvex: {
      notes: { get: ipc.get, export: ipc.export, update: ok, list: ok, trash: ok },
      tags: { list: ok },
      noteTags: { counts: ok, all: ok }
    }
  }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { NoteEditor } = await import('@/components/note-editor')
const { useVaultStore } = await import('@/store/vault.store')
const { toast } = await import('sonner')

const NOTE: Note = {
  id: 'n1',
  title: 'Plan',
  content: '',
  isPinned: false,
  isTrashed: false,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null,
  tags: []
}

async function openWarning(): Promise<void> {
  render(createElement(NoteEditor))
  await waitFor(() => expect(ipc.get).toHaveBeenCalled())
  fireEvent.keyDown(screen.getByRole('button', { name: 'Note actions' }), { key: 'Enter' })
  const item = await screen.findByRole('menuitem', { name: 'Export note…' })
  await act(async () => {
    fireEvent.click(item)
  })
  await screen.findByText(/not encrypted/i)
}

async function press(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

beforeEach(() => {
  // Radix's own auto-focus registers as a focus outside the menu in jsdom; see note-list-sort.
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
  ipc.get.mockResolvedValue({ success: true, data: NOTE })
  useVaultStore.setState({ activeNoteId: 'n1', notes: [], tags: [], noteTagsMap: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('NoteEditor: Export note…', () => {
  it('shows the plaintext warning and exports nothing on Cancel', async () => {
    await openWarning()

    await press('Cancel')

    expect(ipc.export).not.toHaveBeenCalled()
  })

  it('exports the open note and confirms it', async () => {
    ipc.export.mockResolvedValue({ success: true, data: true })
    await openWarning()

    await press('Export')

    expect(ipc.export).toHaveBeenCalledWith('n1')
    expect(toast.success).toHaveBeenCalledWith('Note exported')
  })

  it('says nothing when the save dialog is canceled', async () => {
    ipc.export.mockResolvedValue({ success: true, data: null })
    await openWarning()

    await press('Export')

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows the error when the export fails', async () => {
    ipc.export.mockResolvedValue({ success: false, error: 'Could not write the exported file' })
    await openWarning()

    await press('Export')

    expect(toast.error).toHaveBeenCalledWith('Could not write the exported file')
  })

  it('is not offered for a trashed note', async () => {
    ipc.get.mockResolvedValue({ success: true, data: { ...NOTE, isTrashed: true, trashedAt: 1 } })
    render(createElement(NoteEditor))
    // Waiting for the title means the note, and with it isTrashed, has loaded.
    await screen.findByDisplayValue('Plan')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Note actions' }), { key: 'Enter' })

    await screen.findByRole('menuitem', { name: 'Move to trash' })
    expect(screen.queryByRole('menuitem', { name: 'Export note…' })).toBeNull()
  })
})
