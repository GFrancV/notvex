// @vitest-environment jsdom
import { createElement } from 'react'

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Note, NoteListItem, Tag } from '@shared/types'

const ipc = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  duplicate: vi.fn(),
  counts: vi.fn()
}))

const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({ toast: { error: toastError } }))

// Radix's dropdown keeps module-level state that leaks between jsdom tests, so a second test
// can no longer open it. What's under test is which items exist and what they do, so the
// menu renders its items inline.
vi.mock('@/components/ui/dropdown-menu', async () => {
  const { createElement: h, Fragment } = await import('react')
  const pass = ({ children }: { children?: unknown }): ReturnType<typeof h> =>
    h(Fragment, null, children as never)
  return {
    DropdownMenu: pass,
    DropdownMenuTrigger: pass,
    DropdownMenuContent: pass,
    DropdownMenuGroup: pass,
    DropdownMenuLabel: pass,
    DropdownMenuRadioGroup: pass,
    DropdownMenuRadioItem: pass,
    DropdownMenuSeparator: (): null => null,
    DropdownMenuItem: ({ children, onClick }: { children?: unknown; onClick?: () => void }) =>
      h('div', { role: 'menuitem', onClick }, children as never)
  }
})
// Same reason as the dropdown mock above; NoteList rows and the editor use the context menu.
vi.mock('@/components/ui/context-menu', async () => {
  const { createElement: h, Fragment } = await import('react')
  const pass = ({ children }: { children?: unknown }): ReturnType<typeof h> =>
    h(Fragment, null, children as never)
  return {
    ContextMenu: pass,
    ContextMenuTrigger: pass,
    ContextMenuContent: pass,
    ContextMenuGroup: pass,
    ContextMenuSub: pass,
    ContextMenuSubTrigger: pass,
    ContextMenuSubContent: pass,
    ContextMenuSeparator: (): null => null,
    ContextMenuItem: ({ children, onClick }: { children?: unknown; onClick?: () => void }) =>
      h('div', { role: 'menuitem', onClick }, children as never)
  }
})
vi.mock('@uiw/react-codemirror', () => ({ default: (): null => null }))
vi.mock('@/lib/ipc', () => ({
  notvex: {
    notes: {
      get: ipc.get,
      update: ipc.update,
      list: ipc.list,
      duplicate: ipc.duplicate,
      trash: vi.fn()
    },
    tags: { list: vi.fn() },
    noteTags: { counts: ipc.counts, all: vi.fn() }
  }
}))

const { useDuplicateNote } = await import('@/hooks/use-duplicate-note')
const { createPendingSave } = await import('@/lib/pending-save')
const { NoteEditor } = await import('@/components/note-editor')
const { NoteList } = await import('@/components/note-list')
const { useVaultStore } = await import('@/store/vault.store')
const { useUiStore } = await import('@/store/ui.store')

const tag: Tag = { id: 't1', name: 'work', color: 'blue', createdAt: 0 }

function listItem(id: string, title: string, tags: Tag[] = []): NoteListItem {
  return {
    id,
    title,
    isPinned: false,
    isTrashed: false,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags
  }
}

function note(id: string, isTrashed = false): Note {
  return { ...listItem(id, id.toUpperCase()), content: '', isTrashed }
}

beforeEach(() => {
  ipc.list.mockResolvedValue({ success: true, data: [] })
  ipc.counts.mockResolvedValue({ success: true, data: {} })
  ipc.update.mockResolvedValue({ success: true, data: null })
  useVaultStore.setState({
    activeNoteId: 'a',
    notes: [listItem('a', 'Plan', [tag])],
    tags: [tag],
    noteTagsMap: { a: ['t1'] }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useDuplicateNote', () => {
  it('flushes pending edits before asking main for the copy', async () => {
    const commit = vi.fn(async () => undefined)
    const saver = createPendingSave(commit, 10_000)
    saver.schedule('a', 'typed just now')
    ipc.duplicate.mockResolvedValue({ success: true, data: listItem('b', 'Plan (copy)', [tag]) })

    const { result } = renderHook(() => useDuplicateNote())
    await act(() => result.current('a'))

    expect(commit).toHaveBeenCalledWith('a', 'typed just now')
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(
      ipc.duplicate.mock.invocationCallOrder[0]
    )
    saver.dispose()
  })

  it('does not copy when pending edits fail to save', async () => {
    const saver = createPendingSave(vi.fn().mockRejectedValue(new Error('disk full')), 10_000)
    saver.schedule('a', 'unsaved')

    const { result } = renderHook(() => useDuplicateNote())
    await act(() => result.current('a'))

    expect(ipc.duplicate).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('disk full')
    expect(useVaultStore.getState().activeNoteId).toBe('a')
    saver.dispose()
  })

  it('refreshes tag counts only when the copy carries tags', async () => {
    const { result } = renderHook(() => useDuplicateNote())

    ipc.duplicate.mockResolvedValue({ success: true, data: listItem('b', 'Plan (copy)', [tag]) })
    await act(() => result.current('a'))
    expect(ipc.counts).toHaveBeenCalledTimes(1)

    ipc.duplicate.mockResolvedValue({ success: true, data: listItem('c', 'Bare (copy)') })
    await act(() => result.current('a'))
    expect(ipc.counts).toHaveBeenCalledTimes(1)
  })

  it('opens the copy at the top of the list with its tags and the title focused', async () => {
    ipc.duplicate.mockResolvedValue({ success: true, data: listItem('b', 'Plan (copy)', [tag]) })
    const focusBefore = useUiStore.getState().focusTitleRequest

    const { result } = renderHook(() => useDuplicateNote())
    await act(() => result.current('a'))

    expect(ipc.duplicate).toHaveBeenCalledWith('a')
    const state = useVaultStore.getState()
    expect(state.activeNoteId).toBe('b')
    expect(state.notes.map((n) => n.id)).toEqual(['b', 'a'])
    expect(state.noteTagsMap.b).toEqual(['t1'])
    expect(useUiStore.getState().focusTitleRequest).toBe(focusBefore + 1)
  })

  it('shows the error and stays on the source note when main refuses', async () => {
    ipc.duplicate.mockResolvedValue({ success: false, error: 'Note not found' })

    const { result } = renderHook(() => useDuplicateNote())
    await act(() => result.current('a'))

    expect(toastError).toHaveBeenCalledWith('Note not found')
    expect(useVaultStore.getState().activeNoteId).toBe('a')
    expect(useVaultStore.getState().notes.map((n) => n.id)).toEqual(['a'])
  })
})

describe('NoteEditor — Duplicate menu item', () => {
  it('duplicates the open note from the action menu', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    ipc.duplicate.mockResolvedValue({ success: true, data: listItem('b', 'Plan (copy)') })
    render(createElement(NoteEditor))
    await screen.findByDisplayValue('A')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))

    // Waits for the whole flow, so it can't switch notes under the next test.
    await waitFor(() => expect(useVaultStore.getState().activeNoteId).toBe('b'))
    expect(ipc.duplicate).toHaveBeenCalledWith('a')
    // The first full NoteEditor render in this file, slow on a cold worker.
  }, 20_000)

  it('is not offered for a trashed note', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a', true) })
    render(createElement(NoteEditor))

    // Waiting for the title means the note, and with it isTrashed, has loaded.
    await screen.findByDisplayValue('A')

    expect(screen.getByRole('menuitem', { name: 'Delete file' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).toBeNull()
  })
})

describe('NoteList — Duplicate context item', () => {
  it('duplicates the right-clicked note even when another one is open', async () => {
    const other = listItem('c', 'Other')
    ipc.list.mockResolvedValue({ success: true, data: [other] })
    ipc.duplicate.mockResolvedValue({ success: true, data: listItem('d', 'Other (copy)') })
    useVaultStore.setState({ notes: [other], noteTagsMap: {} })
    useUiStore.setState({ showTrash: false, showPinned: false, activeTags: [], searchQuery: '' })
    render(createElement(NoteList))

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))

    await waitFor(() => expect(useVaultStore.getState().activeNoteId).toBe('d'))
    expect(ipc.duplicate).toHaveBeenCalledWith('c')
  })

  it('is not offered in the trash view', async () => {
    const trashed = { ...listItem('c', 'Other'), isTrashed: true }
    ipc.list.mockResolvedValue({ success: true, data: [trashed] })
    useVaultStore.setState({ notes: [trashed], noteTagsMap: {} })
    useUiStore.setState({ showTrash: true, showPinned: false, activeTags: [], searchQuery: '' })
    render(createElement(NoteList))

    expect(await screen.findByRole('menuitem', { name: /Restore/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).toBeNull()
  })
})
