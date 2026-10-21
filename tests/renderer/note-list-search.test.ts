// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem } from '@shared/types'

function item(id: string, title: string, isTrashed: boolean, isPinned = false): NoteListItem {
  return {
    id,
    title,
    isPinned,
    isTrashed,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags: []
  }
}

const live = [item('a', 'live plan', false, true), item('b', 'live recipe', false)]
const trashed = [item('t1', 'old plan', true), item('t2', 'old recipe', true)]

const ipc = vi.hoisted(() => ({ list: vi.fn() }))

// No `notes.search`: the list filters on its own, and a call to main's search would throw here.
vi.mock('@/lib/ipc', () => ({
  notvex: {
    notes: {
      list: ipc.list,
      counts: vi.fn(async () => ({ success: true, data: { live: 2, pinned: 1, trashed: 2 } }))
    }
  }
}))

const { NoteList } = await import('@/components/note-list')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

const settle = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 50)))

const shown = (): string[] =>
  screen.queryAllByText(/^(live|old) (plan|recipe)$/).map((e) => e.textContent ?? '')

beforeEach(() => {
  ipc.list.mockImplementation(async (f: { trashed?: boolean } = {}) => ({
    success: true,
    data: f.trashed ? trashed : live
  }))
  useUiStore.getState().resetFilters()
  useVaultStore.setState({ notes: [], activeNoteId: null, noteTagsMap: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderList(): Promise<void> {
  await act(async () => {
    render(createElement(NoteList))
  })
  await settle()
}

const search = (query: string): Promise<void> =>
  act(async () => useUiStore.getState().setSearchQuery(query))

describe('search in the All notes view', () => {
  it('filters the live notes by title', async () => {
    await renderList()

    await search('plan')

    expect(shown()).toEqual(['live plan'])
  })

  it('ignores case and surrounding spaces in the query', async () => {
    await renderList()

    await search('  PLAN ')

    expect(shown()).toEqual(['live plan'])
  })

  it('with a tag active, keeps only the tagged notes that match', async () => {
    useVaultStore.setState({ noteTagsMap: { a: ['t'], b: ['t'] } })
    useUiStore.setState({ activeTags: ['t'] })
    await renderList()

    await search('recipe')

    expect(shown()).toEqual(['live recipe'])
  })

  it('says there are no results, not that the view is empty', async () => {
    useUiStore.setState({ showTrash: true })
    await renderList()

    await search('nothing matches this')

    expect(screen.getByText('No results')).toBeTruthy()
  })

  it('survives a list reload, as after a pin, a trash or a save', async () => {
    await renderList()
    await search('plan')

    await act(() => useVaultStore.getState().loadNotes({ trashed: false }))
    await settle()

    expect(shown()).toEqual(['live plan'])
  })
})

describe('search in the Trash view', () => {
  it('opening Trash with a query shows only the matching trashed notes', async () => {
    await renderList()
    await search('plan')

    await act(async () => useUiStore.getState().setShowTrash(true))
    await settle()

    expect(shown()).toEqual(['old plan'])
  })

  it('typing while in Trash filters the trashed notes, never the live ones', async () => {
    useUiStore.setState({ showTrash: true })
    await renderList()

    await search('recipe')

    expect(shown()).toEqual(['old recipe'])
  })

  it('shows every trashed note when the query is empty', async () => {
    useUiStore.setState({ showTrash: true })
    await renderList()

    expect(shown().sort()).toEqual(['old plan', 'old recipe'])
  })

  it('leaving Trash with a query shows the matching live notes', async () => {
    useUiStore.setState({ showTrash: true, searchQuery: 'plan' })
    await renderList()

    await act(async () => useUiStore.getState().setShowTrash(false))
    await settle()

    expect(shown()).toEqual(['live plan'])
  })
})

describe('search in the Pinned view', () => {
  it('keeps only the pinned notes that match', async () => {
    useUiStore.setState({ showPinned: true })
    await renderList()

    await search('live')
    expect(shown()).toEqual(['live plan'])

    await search('recipe')
    expect(shown()).toEqual([])
  })
})
