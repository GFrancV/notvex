// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Note, NoteListItem } from '@shared/types'

const ipc = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  delete: vi.fn(),
  emptyTrash: vi.fn(),
  counts: vi.fn()
}))

const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

// Radix menus keep module-level state that leaks between jsdom tests; render items inline.
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
      trash: ipc.trash,
      restore: ipc.restore,
      delete: ipc.delete,
      emptyTrash: ipc.emptyTrash
    },
    tags: { list: vi.fn() },
    noteTags: { counts: ipc.counts, all: vi.fn() }
  }
}))

const { useTogglePin } = await import('@/hooks/use-toggle-pin')
const { NoteEditor } = await import('@/components/note-editor')
const { NoteList } = await import('@/components/note-list')
const { useVaultStore } = await import('@/store/vault.store')
const { useUiStore } = await import('@/store/ui.store')

function listItem(id: string, overrides: Partial<NoteListItem> = {}): NoteListItem {
  return {
    id,
    title: id.toUpperCase(),
    isPinned: false,
    isTrashed: false,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags: [],
    ...overrides
  }
}

function note(id: string): Note {
  return { ...listItem(id), content: '' }
}

beforeEach(() => {
  ipc.list.mockResolvedValue({ success: true, data: [] })
  ipc.counts.mockResolvedValue({ success: true, data: {} })
  ipc.update.mockResolvedValue({ success: true, data: null })
  useVaultStore.setState({ activeNoteId: 'a', notes: [listItem('a')], noteTagsMap: {} })
  useUiStore.setState({ showTrash: false, showPinned: false, activeTags: [], searchQuery: '' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useTogglePin', () => {
  it('flips the pin and reloads the current view', async () => {
    useUiStore.setState({ showTrash: true })
    const { result } = renderHook(() => useTogglePin())

    let ok = false
    await act(async () => {
      ok = await result.current(listItem('a'))
    })

    expect(ok).toBe(true)
    expect(ipc.update).toHaveBeenCalledWith('a', { isPinned: true })
    expect(ipc.list).toHaveBeenCalledWith({ trashed: true })
  })

  it('shows the error and does not reload when main refuses', async () => {
    ipc.update.mockResolvedValue({ success: false, error: 'DB locked' })
    const { result } = renderHook(() => useTogglePin())

    let ok = true
    await act(async () => {
      ok = await result.current(listItem('a'))
    })

    expect(ok).toBe(false)
    expect(toastError).toHaveBeenCalledWith('DB locked')
    expect(ipc.list).not.toHaveBeenCalled()
  })

  it('treats a rejected invoke as a failure', async () => {
    ipc.update.mockRejectedValue(new Error('channel closed'))
    const { result } = renderHook(() => useTogglePin())

    let ok = true
    await act(async () => {
      ok = await result.current(listItem('a'))
    })

    expect(ok).toBe(false)
    expect(toastError).toHaveBeenCalledWith('Failed to update note')
  })
})

describe('NoteEditor — pin', () => {
  it('keeps the note unpinned when the pin fails', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    render(createElement(NoteEditor))
    await screen.findByDisplayValue('A')
    ipc.update.mockResolvedValue({ success: false, error: 'DB locked' })

    await act(async () => {
      fireEvent.click(screen.getByTitle('Pin'))
    })

    expect(toastError).toHaveBeenCalledWith('DB locked')
    expect(screen.getByTitle('Pin')).toBeTruthy()
    expect(screen.queryByTitle('Unpin')).toBeNull()
    // The first full NoteEditor render in this file, slow on a cold worker.
  }, 20_000)
})

describe('NoteList — pin', () => {
  it('shows the error when the pin fails', async () => {
    ipc.list.mockResolvedValue({ success: true, data: [listItem('a')] })
    ipc.update.mockResolvedValue({ success: false, error: 'DB locked' })
    render(createElement(NoteList))

    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }))
    })

    expect(toastError).toHaveBeenCalledWith('DB locked')
  })
})
