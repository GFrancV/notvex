// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem } from '@shared/types'

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

const item = (id: string, title: string, isTrashed: boolean): NoteListItem => ({
  id,
  title,
  isPinned: false,
  isTrashed,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: isTrashed ? 0 : null,
  tags: []
})
const LIVE = item('live', 'Live note', false)
const TRASHED = item('gone', 'Trashed note', true)

let resolveTrash: (notes: NoteListItem[]) => void = () => {}

beforeEach(async () => {
  usePrefsStore.setState({ noteSort: { field: 'updatedAt', direction: 'desc' } })
  ipc.notes.counts.mockImplementation(() => ok({ live: 1, pinned: 0, trashed: 1 }))
  ipc.noteTags.counts.mockImplementation(() => ok([]))
  ipc.notes.list.mockImplementation(({ trashed }: { trashed?: boolean }) =>
    trashed
      ? new Promise((resolve) => {
          resolveTrash = (notes) => resolve({ success: true, data: notes })
        })
      : ok([LIVE])
  )
  useUiStore.setState({ activeTags: [], searchQuery: '', showTrash: false, showPinned: false })
  useVaultStore.setState({ notes: [], noteTagsMap: {}, activeNoteId: null })
  render(createElement(NoteList), { wrapper: TooltipProvider })
  await screen.findByText('Live note')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('NoteList across a view switch', () => {
  it('shows no note from the previous view while the new one loads', async () => {
    await act(async () => useUiStore.getState().setShowTrash(true))

    // A live note here would offer the trash's Delete permanently.
    expect(screen.queryByText('Live note')).toBeNull()
    expect(screen.queryByText('Trash is empty')).toBeNull()
    // Nor would "Empty trash" count them.
    expect(screen.queryByRole('button', { name: /Empty trash/ })).toBeNull()

    await act(async () => resolveTrash([TRASHED]))
    expect(screen.getByText('Trashed note')).toBeTruthy()
  })

  it('says it is loading only when the load takes a while', async () => {
    vi.useFakeTimers()
    await act(async () => useUiStore.getState().setShowTrash(true))

    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText('Loading…')).toBeNull()

    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('Loading…')).toBeTruthy()

    await act(async () => resolveTrash([TRASHED]))
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('Trashed note')).toBeTruthy()
  })

  it('keeps the list in the pinned view, which filters the same notes', async () => {
    await act(async () => useUiStore.getState().setShowPinned(true))

    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('No pinned notes')).toBeTruthy()
  })
})
