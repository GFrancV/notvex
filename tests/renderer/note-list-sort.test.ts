// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem } from '@shared/types'

const ipc = vi.hoisted(() => {
  const now = Date.now()
  const note = (
    id: string,
    title: string,
    createdAgo: number,
    updatedAgo: number
  ): NoteListItem => ({
    id,
    title,
    isPinned: false,
    isTrashed: false,
    createdAt: now - createdAgo,
    updatedAt: now - updatedAgo,
    trashedAt: null,
    tags: []
  })
  const H = 60 * 60 * 1000
  const all = [note('n-b', 'Beta', 3 * 24 * H, H), note('n-a', 'Alpha', 24 * H, 2 * H)]
  return {
    all,
    notes: {
      list: vi.fn(() => Promise.resolve({ success: true, data: all })),
      search: vi.fn(() => Promise.resolve({ success: true, data: all }))
    },
    prefs: { set: vi.fn(() => Promise.resolve({ success: true, data: null })) }
  }
})

vi.mock('@/lib/ipc', () => ({ notvex: { notes: ipc.notes, prefs: ipc.prefs } }))

const { NoteList } = await import('@/components/note-list')
const { usePrefsStore } = await import('@/store/prefs.store')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

const titles = (): string[] =>
  screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '')

function openSortMenu(): void {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Sort notes' }), { key: 'Enter' })
}

beforeEach(() => {
  // In jsdom, from the second time a Radix menu opens in a file, its own auto-focus on mount
  // registers as a focus outside the menu and closes it at once. Real browsers don't do this;
  // without focus moving, open/select behave as they do in the app.
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
  useUiStore.setState({ activeTags: [], searchQuery: '', showTrash: false, showPinned: false })
  useVaultStore.setState({ notes: ipc.all, noteTagsMap: {}, tags: [] })
  usePrefsStore.setState({ noteSort: { field: 'updatedAt', direction: 'desc' } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('note list sort menu', () => {
  it('reorders the list and saves the choice when a field is picked', async () => {
    render(createElement(NoteList))
    expect(titles()).toEqual(['Beta', 'Alpha'])

    openSortMenu()
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Title' }))
    })

    // Picking a field resets to its natural direction (A–Z), not the previous newest-first.
    expect(titles()).toEqual(['Alpha', 'Beta'])
    expect(ipc.prefs.set).toHaveBeenCalledExactlyOnceWith('noteSort', {
      field: 'title',
      direction: 'asc'
    })
  })

  it('labels the direction for the active field and saves a direction change', async () => {
    usePrefsStore.setState({ noteSort: { field: 'title', direction: 'asc' } })
    render(createElement(NoteList))

    openSortMenu()
    expect(await screen.findByRole('menuitemradio', { name: 'A–Z' })).toHaveProperty(
      'ariaChecked',
      'true'
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Z–A' }))
    })

    expect(titles()).toEqual(['Beta', 'Alpha'])
    expect(ipc.prefs.set).toHaveBeenCalledExactlyOnceWith('noteSort', {
      field: 'title',
      direction: 'desc'
    })
  })

  it('offers newest/oldest labels for date fields', async () => {
    render(createElement(NoteList))
    openSortMenu()
    expect(await screen.findByRole('menuitemradio', { name: 'Newest first' })).toBeDefined()
    expect(screen.getByRole('menuitemradio', { name: 'Oldest first' })).toBeDefined()
  })

  it('shows the created date on each row only when sorting by date created', () => {
    const { rerender } = render(createElement(NoteList))
    expect(screen.getByText('about 1 hour ago')).toBeDefined()

    act(() => usePrefsStore.setState({ noteSort: { field: 'createdAt', direction: 'desc' } }))
    rerender(createElement(NoteList))

    expect(screen.getByText('3 days ago')).toBeDefined()
    expect(screen.queryByText('about 1 hour ago')).toBeNull()
  })
})
