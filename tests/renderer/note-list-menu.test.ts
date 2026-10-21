// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem } from '@shared/types'

const ok = <T>(data: T): Promise<{ success: true; data: T }> =>
  Promise.resolve({ success: true, data })

const ipc = vi.hoisted(() => ({
  notes: {
    list: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    delete: vi.fn(),
    counts: vi.fn()
  },
  noteTags: { counts: vi.fn() }
}))

vi.mock('@/lib/ipc', () => ({ notvex: { notes: ipc.notes, noteTags: ipc.noteTags } }))

const { NoteList } = await import('@/components/note-list')
const { usePrefsStore } = await import('@/store/prefs.store')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

function note(overrides: Partial<NoteListItem> = {}): NoteListItem {
  return {
    id: 'n1',
    title: 'Groceries',
    isPinned: false,
    isTrashed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    trashedAt: null,
    tags: [],
    ...overrides
  }
}

function renderList(item: NoteListItem, inTrash: boolean): void {
  ipc.notes.list.mockImplementation(() => ok([item]))
  useUiStore.setState({ activeTags: [], searchQuery: '', showTrash: inTrash, showPinned: false })
  useVaultStore.setState({ notes: [item], noteTagsMap: {}, activeNoteId: null })
  render(createElement(NoteList))
}

const row = (): HTMLElement => screen.getByRole('button', { name: /Groceries/ })

beforeEach(() => {
  // See note-list-sort.test.ts: Radix menus close at once in jsdom once focus moves on mount.
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
  usePrefsStore.setState({ noteSort: { field: 'updatedAt', direction: 'desc' } })
  for (const fn of Object.values(ipc.notes)) fn.mockImplementation(() => ok(null))
  ipc.noteTags.counts.mockImplementation(() => ok([]))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('NoteList row context menu', () => {
  // Trash, restore and delete share a handler type, so a swapped prop would typecheck; each
  // item is pinned to its IPC call, and the destructive pair is checked against each other.
  it.each([
    { item: 'Pin', inTrash: false, isPinned: false, call: ['update', 'n1', { isPinned: true }] },
    { item: 'Unpin', inTrash: false, isPinned: true, call: ['update', 'n1', { isPinned: false }] },
    { item: 'Move to trash', inTrash: false, isPinned: false, call: ['trash', 'n1'] },
    { item: 'Restore', inTrash: true, isPinned: false, call: ['restore', 'n1'] }
  ] as const)(
    'right-click → $item calls the matching IPC',
    async ({ item, inTrash, isPinned, call }) => {
      renderList(note({ isPinned, isTrashed: inTrash }), inTrash)

      fireEvent.contextMenu(row())
      const menuItem = await screen.findByRole('menuitem', { name: item })
      await act(async () => {
        fireEvent.click(menuItem)
      })

      const [method, ...args] = call
      expect(ipc.notes[method]).toHaveBeenCalledExactlyOnceWith(...args)
      for (const other of ['trash', 'delete'] as const) {
        if (other !== method) expect(ipc.notes[other]).not.toHaveBeenCalled()
      }
    }
  )

  it('right-click → Delete permanently calls delete once confirmed', async () => {
    renderList(note({ isTrashed: true }), true)

    fireEvent.contextMenu(row())
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }))
    expect(ipc.notes.delete).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    })

    expect(ipc.notes.delete).toHaveBeenCalledExactlyOnceWith('n1')
    expect(ipc.notes.trash).not.toHaveBeenCalled()
  })

  it('opens the note on left click without opening the menu', () => {
    renderList(note(), false)

    fireEvent.click(row())

    expect(useVaultStore.getState().activeNoteId).toBe('n1')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
