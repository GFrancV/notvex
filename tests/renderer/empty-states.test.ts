// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ok = <T>(data: T): Promise<{ success: true; data: T }> =>
  Promise.resolve({ success: true, data })

const ipc = vi.hoisted(() => ({
  notes: { list: vi.fn(), counts: vi.fn() },
  noteTags: { counts: vi.fn() }
}))

vi.mock('@/lib/ipc', () => ({ notvex: { notes: ipc.notes, noteTags: ipc.noteTags } }))

const { NoteList } = await import('@/components/note-list')
const { usePrefsStore } = await import('@/store/prefs.store')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

beforeEach(() => {
  usePrefsStore.setState({ noteSort: { field: 'updatedAt', direction: 'desc' } })
  ipc.notes.list.mockImplementation(() => ok([]))
  ipc.notes.counts.mockImplementation(() => ok({ live: 0, pinned: 0, trashed: 0 }))
  ipc.noteTags.counts.mockImplementation(() => ok([]))
  useVaultStore.setState({ notes: [], notesTrashed: false, noteTagsMap: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderList(showTrash: boolean): Promise<void> {
  useUiStore.setState({ activeTags: [], searchQuery: '', showTrash, showPinned: false })
  useVaultStore.setState({ notesTrashed: showTrash })
  await act(async () => {
    render(createElement(NoteList), { wrapper: TooltipProvider })
  })
}

describe('note list empty state', () => {
  it('says how to create a note when the vault has none', async () => {
    await renderList(false)

    expect(screen.getByText('No notes yet')).toBeTruthy()
    expect(screen.getByText(/to create/).textContent).toBe('Ctrl N to create')
  })

  it('offers nothing in an empty trash', async () => {
    await renderList(true)

    expect(screen.getByText('Trash is empty')).toBeTruthy()
    expect(screen.queryByText(/to create/)).toBeNull()
  })
})
