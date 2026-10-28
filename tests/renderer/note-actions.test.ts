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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(toast, { error: toastError }) }))

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
      emptyTrash: ipc.emptyTrash,
      counts: vi.fn(async () => ({ success: true, data: { live: 0, pinned: 0, trashed: 0 } }))
    },
    tags: { list: vi.fn() },
    noteTags: { counts: ipc.counts, all: vi.fn() }
  }
}))

// Radix positions tooltips with ResizeObserver, which jsdom doesn't implement.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const { useTogglePin } = await import('@/hooks/use-toggle-pin')
const { useTrashNote } = await import('@/hooks/use-trash-note')
const { NoteEditor } = await import('@/components/note-editor')
const { NoteList } = await import('@/components/note-list')
const { useVaultStore } = await import('@/store/vault.store')
const { useUiStore } = await import('@/store/ui.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
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
  it('says what the pin button does in a tooltip', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await screen.findByDisplayValue('A')

    fireEvent.focus(screen.getByRole('button', { name: 'Pin' }))

    expect((await screen.findByRole('tooltip')).textContent).toBe('Pin')
  }, 20_000)

  it('keeps the note unpinned when the pin fails', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await screen.findByDisplayValue('A')
    ipc.update.mockResolvedValue({ success: false, error: 'DB locked' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    })

    expect(toastError).toHaveBeenCalledWith('DB locked')
    expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unpin' })).toBeNull()
    // The first full NoteEditor render in this file, slow on a cold worker.
  }, 20_000)

  it('shows the note as pinned once the pin is saved', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await screen.findByDisplayValue('A')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    })

    expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy()
  })

  it('a pin that resolves after switching notes leaves the new note alone', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await screen.findByDisplayValue('A')
    const pin = deferred<{ success: true; data: null }>()
    ipc.update.mockReturnValue(pin.promise)

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    ipc.get.mockResolvedValue({ success: true, data: note('b') })
    act(() => useVaultStore.setState({ activeNoteId: 'b' }))
    await screen.findByDisplayValue('B')
    await act(async () => pin.resolve({ success: true, data: null }))

    expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unpin' })).toBeNull()
  })

  it('follows a pin made from the note list, and the next click unpins', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await screen.findByDisplayValue('A')
    // The reload never lands, so only the store patch made on save can flip the icon.
    ipc.list.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useTogglePin())

    await act(async () => {
      await result.current(listItem('a'))
    })

    expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unpin' }))
    })
    expect(ipc.update).toHaveBeenLastCalledWith('a', { isPinned: false })
  })
})

describe('NoteList — pin', () => {
  it('shows the error when the pin fails', async () => {
    ipc.list.mockResolvedValue({ success: true, data: [listItem('a')] })
    ipc.update.mockResolvedValue({ success: false, error: 'DB locked' })
    render(createElement(NoteList), { wrapper: TooltipProvider })

    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }))
    })

    expect(toastError).toHaveBeenCalledWith('DB locked')
  })
})

describe('useTrashNote', () => {
  it('trashes, closes the open note and reloads the current view', async () => {
    ipc.trash.mockResolvedValue({ success: true, data: null })
    const { result } = renderHook(() => useTrashNote())

    let ok = false
    await act(async () => {
      ok = await result.current('a')
    })

    expect(ok).toBe(true)
    expect(useVaultStore.getState().activeNoteId).toBeNull()
    expect(ipc.list).toHaveBeenCalledWith({ trashed: false })
    expect(ipc.counts).toHaveBeenCalled()
  })

  it('leaves another open note alone', async () => {
    ipc.trash.mockResolvedValue({ success: true, data: null })
    const { result } = renderHook(() => useTrashNote())

    await act(async () => {
      await result.current('b')
    })

    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })

  it('shows the error and keeps the note open when main refuses', async () => {
    ipc.trash.mockResolvedValue({ success: false, error: 'DB locked' })
    const { result } = renderHook(() => useTrashNote())

    let ok = true
    await act(async () => {
      ok = await result.current('a')
    })

    expect(ok).toBe(false)
    expect(toastError).toHaveBeenCalledWith('DB locked')
    expect(useVaultStore.getState().activeNoteId).toBe('a')
    expect(ipc.list).not.toHaveBeenCalled()
  })

  async function trashAndUndo(id: string, beforeUndo?: () => void): Promise<void> {
    ipc.trash.mockResolvedValue({ success: true, data: null })
    const { result } = renderHook(() => useTrashNote())
    await act(async () => {
      await result.current(id)
    })
    const [message, options] = toast.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } }
    ]
    expect(message).toBe('Moved to trash')
    expect(options.action.label).toBe('Undo')
    beforeUndo?.()
    await act(async () => {
      options.action.onClick()
    })
  }

  it('offers Undo, which restores the note and reopens it', async () => {
    ipc.restore.mockResolvedValue({ success: true, data: null })

    await trashAndUndo('a')

    expect(ipc.restore).toHaveBeenCalledExactlyOnceWith('a')
    await waitFor(() => expect(useVaultStore.getState().activeNoteId).toBe('a'))
  })

  it('Undo leaves a note opened in the meantime alone', async () => {
    ipc.restore.mockResolvedValue({ success: true, data: null })

    await trashAndUndo('a', () => useVaultStore.setState({ activeNoteId: 'b' }))

    await waitFor(() => expect(ipc.restore).toHaveBeenCalledWith('a'))
    expect(useVaultStore.getState().activeNoteId).toBe('b')
  })

  it('Undo shows the error and keeps the note closed when the restore fails', async () => {
    ipc.restore.mockRejectedValue(new Error('vault locked'))

    await trashAndUndo('a')

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to restore note'))
    expect(useVaultStore.getState().activeNoteId).toBeNull()
  })

  it('treats a rejected invoke as a failure', async () => {
    ipc.trash.mockRejectedValue(new Error('channel closed'))
    const { result } = renderHook(() => useTrashNote())

    await act(async () => {
      await result.current('a')
    })

    expect(toastError).toHaveBeenCalledWith('Failed to move note to trash')
    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })
})

describe('NoteEditor — trash', () => {
  it('keeps the note open when the trash fails', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    ipc.trash.mockResolvedValue({ success: false, error: 'DB locked' })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await screen.findByDisplayValue('A')

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }))
    })

    expect(toastError).toHaveBeenCalledWith('DB locked')
    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })
})

describe('NoteEditor — tags', () => {
  const WORK = { id: 't-work', name: 'work', color: '#fff', createdAt: 0 }

  beforeAll(() => {
    // cmdk scrolls its list; jsdom doesn't implement scrolling.
    Element.prototype.scrollIntoView ??= (): void => {}
  })

  async function openEditor(): Promise<void> {
    useVaultStore.setState({ tags: [WORK], noteTagsMap: { a: [WORK.id] } })
    ipc.get.mockResolvedValue({ success: true, data: note('a') })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await screen.findByDisplayValue('A')
  }

  it('opens the tag picker from its button, and Escape closes it', async () => {
    await openEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    const search = await screen.findByRole('combobox', { name: 'Search tags' })
    fireEvent.keyDown(search, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
  })

  it('opens both pickers from the command palette and clears the request on close', async () => {
    await openEditor()

    act(() => useUiStore.setState({ tagSelectorNoteId: 'a' }))
    fireEvent.keyDown(await screen.findByRole('combobox', { name: 'Search tags' }), {
      key: 'Escape'
    })
    await waitFor(() => expect(useUiStore.getState().tagSelectorNoteId).toBeNull())

    act(() => useUiStore.setState({ removeTagNoteId: 'a' }))
    expect(await screen.findByRole('combobox', { name: 'Remove tag' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'work' })).toBeTruthy()
  })
})

describe('NoteList — trash view actions', () => {
  beforeEach(() => {
    const trashed = listItem('a', { isTrashed: true })
    ipc.list.mockResolvedValue({ success: true, data: [trashed] })
    useVaultStore.setState({ notes: [trashed] })
    useUiStore.setState({ showTrash: true })
  })

  it('shows the error when restore fails', async () => {
    ipc.restore.mockResolvedValue({ success: false, error: 'DB locked' })
    render(createElement(NoteList), { wrapper: TooltipProvider })

    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: /Restore/ }))
    })

    expect(toastError).toHaveBeenCalledWith('DB locked')
  })

  it('keeps the open note when delete fails', async () => {
    ipc.delete.mockResolvedValue({ success: false, error: 'DB locked' })
    render(createElement(NoteList), { wrapper: TooltipProvider })

    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete permanently/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    })

    expect(toastError).toHaveBeenCalledWith('DB locked')
    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })

  it('keeps the open note when empty trash fails', async () => {
    ipc.emptyTrash.mockRejectedValue(new Error('channel closed'))
    render(createElement(NoteList), { wrapper: TooltipProvider })

    fireEvent.click(await screen.findByRole('button', { name: /Empty trash/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }))
    })

    expect(toastError).toHaveBeenCalledWith('Failed to empty trash')
    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })

  it('deletes nothing until the delete is confirmed', async () => {
    ipc.delete.mockResolvedValue({ success: true, data: null })
    render(createElement(NoteList), { wrapper: TooltipProvider })

    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete permanently/ }))
    expect(ipc.delete).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    })

    expect(ipc.delete).toHaveBeenCalledWith('a')
    expect(useVaultStore.getState().activeNoteId).toBeNull()
  })

  it('cancelling the delete keeps the note', async () => {
    render(createElement(NoteList), { wrapper: TooltipProvider })

    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete permanently/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(ipc.delete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancelling empty trash keeps the notes', async () => {
    render(createElement(NoteList), { wrapper: TooltipProvider })

    fireEvent.click(await screen.findByRole('button', { name: /Empty trash/ }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(ipc.emptyTrash).not.toHaveBeenCalled()
  })

  it('empty trash closes the open note and reloads the trash once confirmed', async () => {
    ipc.emptyTrash.mockResolvedValue({ success: true, data: null })
    render(createElement(NoteList), { wrapper: TooltipProvider })

    fireEvent.click(await screen.findByRole('button', { name: /Empty trash/ }))
    ipc.list.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }))
    })

    expect(ipc.emptyTrash).toHaveBeenCalledTimes(1)
    expect(useVaultStore.getState().activeNoteId).toBeNull()
    expect(ipc.list).toHaveBeenCalledWith({ trashed: true })
  })

  it('the dialog cannot be dismissed while the delete runs', async () => {
    const del = deferred<{ success: true; data: null }>()
    ipc.delete.mockReturnValue(del.promise)
    render(createElement(NoteList), { wrapper: TooltipProvider })

    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete permanently/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => del.resolve({ success: true, data: null }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a double click on confirm deletes once', async () => {
    const del = deferred<{ success: true; data: null }>()
    ipc.delete.mockReturnValue(del.promise)
    render(createElement(NoteList), { wrapper: TooltipProvider })

    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete permanently/ }))
    const confirm = screen.getByRole('button', { name: 'Delete permanently' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await act(async () => del.resolve({ success: true, data: null }))

    expect(ipc.delete).toHaveBeenCalledTimes(1)
  })
})

describe('NoteList — trash', () => {
  it('keeps the open note when the trash fails', async () => {
    ipc.list.mockResolvedValue({ success: true, data: [listItem('a')] })
    ipc.trash.mockResolvedValue({ success: false, error: 'DB locked' })
    render(createElement(NoteList), { wrapper: TooltipProvider })

    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to trash' }))
    })

    expect(toastError).toHaveBeenCalledWith('DB locked')
    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })
})
