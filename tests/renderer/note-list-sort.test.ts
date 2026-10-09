// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem, Prefs } from '@shared/types'

const ipc = vi.hoisted(() => {
  const now = Date.now()
  const H = 60 * 60 * 1000
  const note = (
    id: string,
    title: string,
    createdDays: number,
    updatedHours: number
  ): NoteListItem => ({
    id,
    title,
    isPinned: false,
    isTrashed: false,
    createdAt: now - createdDays * 24 * H,
    updatedAt: now - updatedHours * H,
    trashedAt: null,
    tags: []
  })
  // Alpha, Gamma, Beta is an order no sort produces, so a list rendered in it was not sorted:
  //   title A–Z: Alpha Beta Gamma    modified newest: Beta Alpha Gamma
  //   created newest: Alpha Beta Gamma (and the reverse of each)
  const all = [note('n-a', 'Alpha', 1, 2), note('n-g', 'Gamma', 3, 3), note('n-b', 'Beta', 2, 1)]
  return {
    all,
    notes: {
      list: vi.fn(() => Promise.resolve({ success: true, data: all })),
      search: vi.fn(() => Promise.resolve({ success: true, data: all }))
    },
    prefs: {
      get: vi.fn(),
      set: vi.fn(() => Promise.resolve({ success: true, data: null }))
    }
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

async function pick(name: string): Promise<void> {
  const item = await screen.findByRole('menuitemradio', { name })
  await act(async () => {
    fireEvent.click(item)
  })
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
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('note list sort menu', () => {
  it('reorders the list and saves the choice when a field is picked', async () => {
    render(createElement(NoteList))
    expect(titles()).toEqual(['Beta', 'Alpha', 'Gamma'])

    openSortMenu()
    await pick('Title')

    // Picking a field resets to its natural direction (A–Z), not the previous newest-first.
    expect(titles()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(ipc.prefs.set).toHaveBeenCalledExactlyOnceWith('noteSort', {
      field: 'title',
      direction: 'asc'
    })
  })

  it('starts a date field newest first when coming from title', async () => {
    usePrefsStore.setState({ noteSort: { field: 'title', direction: 'asc' } })
    render(createElement(NoteList))

    openSortMenu()
    await pick('Date created')

    expect(ipc.prefs.set).toHaveBeenCalledExactlyOnceWith('noteSort', {
      field: 'createdAt',
      direction: 'desc'
    })
  })

  it('keeps the direction when the already-checked field is picked again', async () => {
    usePrefsStore.setState({ noteSort: { field: 'title', direction: 'desc' } })
    render(createElement(NoteList))

    openSortMenu()
    await pick('Title')

    expect(titles()).toEqual(['Gamma', 'Beta', 'Alpha'])
    expect(ipc.prefs.set).not.toHaveBeenCalled()
  })

  it('labels the direction for the active field and saves a direction change', async () => {
    usePrefsStore.setState({ noteSort: { field: 'title', direction: 'asc' } })
    render(createElement(NoteList))
    expect(titles()).toEqual(['Alpha', 'Beta', 'Gamma'])

    openSortMenu()
    expect(await screen.findByRole('menuitemradio', { name: 'A–Z' })).toHaveProperty(
      'ariaChecked',
      'true'
    )
    await pick('Z–A')

    expect(titles()).toEqual(['Gamma', 'Beta', 'Alpha'])
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

describe('note list sort sources', () => {
  it('sorts search results, which arrive in server order', async () => {
    vi.useFakeTimers()
    usePrefsStore.setState({ noteSort: { field: 'title', direction: 'asc' } })
    render(createElement(NoteList))

    act(() => useUiStore.setState({ searchQuery: 'a' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(ipc.notes.search).toHaveBeenCalledWith('a')
    expect(titles()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('applies the sort saved in prefs once the store loads', async () => {
    const saved: Prefs = {
      recentVaults: [],
      autoLockMinutes: 15,
      allowScreenCapture: false,
      lockOnMinimize: false,
      clipboardClearSeconds: 60,
      noteSort: { field: 'title', direction: 'desc' }
    }
    ipc.prefs.get.mockResolvedValue({ success: true, data: saved })
    render(createElement(NoteList))
    expect(titles()).toEqual(['Beta', 'Alpha', 'Gamma'])

    await act(() => usePrefsStore.getState().load())

    expect(titles()).toEqual(['Gamma', 'Beta', 'Alpha'])
  })
})
