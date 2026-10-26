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

function note(id: string, title: string): NoteListItem {
  return {
    id,
    title,
    isPinned: false,
    isTrashed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    trashedAt: null,
    tags: []
  }
}

const notes = [note('n1', 'Groceries'), note('n2', 'Recipes')]
const row = (name: string): HTMLElement => screen.getByRole('button', { name: new RegExp(name) })

beforeEach(() => {
  usePrefsStore.setState({ noteSort: { field: 'updatedAt', direction: 'desc' } })
  ipc.notes.list.mockImplementation(() => ok(notes))
  ipc.notes.counts.mockImplementation(() => ok(null))
  ipc.noteTags.counts.mockImplementation(() => ok([]))
  useUiStore.setState({ activeTags: [], searchQuery: '', showTrash: false, showPinned: false })
  useVaultStore.setState({ notes, noteTagsMap: {}, activeNoteId: 'n1' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NoteList selected row', () => {
  it('marks only the open note as current', () => {
    render(createElement(NoteList))

    expect(row('Groceries').getAttribute('aria-current')).toBe('true')
    expect(row('Recipes').hasAttribute('aria-current')).toBe(false)
  })

  it('moves the mark when another note opens', () => {
    render(createElement(NoteList))

    act(() => useVaultStore.setState({ activeNoteId: 'n2' }))

    expect(row('Groceries').hasAttribute('aria-current')).toBe(false)
    expect(row('Recipes').getAttribute('aria-current')).toBe('true')
  })
})
