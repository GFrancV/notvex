// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Note, NoteListItem } from '@shared/types'

const ipc = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(async () => ({ success: true, data: null })),
  list: vi.fn(async () => ({ success: true, data: [] }))
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    notes: {
      get: ipc.get,
      update: ipc.update,
      list: ipc.list,
      counts: vi.fn(async () => ({ success: true, data: { live: 0, pinned: 0, trashed: 0 } }))
    },
    prefs: { set: vi.fn(async () => ({ success: true, data: null })) },
    tags: { list: vi.fn(async () => ({ success: true, data: [] })) },
    noteTags: {
      counts: vi.fn(async () => ({ success: true, data: {} })),
      all: vi.fn(async () => ({ success: true, data: [] }))
    }
  }
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
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
    DropdownMenuSeparator: (): null => null,
    DropdownMenuItem: ({ children, onClick }: { children?: unknown; onClick?: () => void }) =>
      h('div', { role: 'menuitem', onClick }, children as never)
  }
})

const { NoteEditor } = await import('@/components/note-editor')
const { togglePrivacyMode } = await import('@/hooks/use-privacy-mode')
const { useCreateNote } = await import('@/hooks/use-create-note')
const { useDuplicateNote } = await import('@/hooks/use-duplicate-note')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { usePrefsStore } = await import('@/store/prefs.store')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

const SECRET_TITLE = 'Seed phrases'
const SECRET_BODY = 'abandon ability able'

function item(id: string, title: string): NoteListItem {
  return {
    id,
    title,
    isPinned: false,
    isTrashed: false,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags: []
  }
}

const notes: Record<string, Note> = {
  a: { ...item('a', SECRET_TITLE), content: SECRET_BODY },
  b: { ...item('b', 'Grocery list'), content: 'eggs' }
}

const settle = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 50)))

function expectHidden(): void {
  expect(screen.getByText('This note is hidden')).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'Note title' })).toBeNull()
  expect(document.querySelector('.cm-editor')).toBeNull()
  expect(screen.queryByText(/words? ·/)).toBeNull()
  const page = document.body.innerHTML
  expect(page).not.toContain(SECRET_TITLE)
  expect(page).not.toContain(SECRET_BODY)
}

async function renderEditor(): Promise<void> {
  await act(async () => {
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
  })
  await settle()
}

// CodeMirror measures text, and jsdom has no layout.
beforeAll(() => {
  Range.prototype.getClientRects = (): DOMRectList => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect()
})

beforeEach(() => {
  ipc.get.mockImplementation(async (id: string) => ({ success: true, data: notes[id] }))
  usePrefsStore.setState({ privacyMode: true })
  useUiStore.setState({ revealedNoteId: null })
  useVaultStore.setState({
    activeNoteId: 'a',
    notes: [item('a', SECRET_TITLE), item('b', 'Grocery list')],
    tags: [],
    noteTagsMap: {}
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  usePrefsStore.setState({ privacyMode: false })
})

describe('NoteEditor in privacy mode', () => {
  it('with privacy mode on, a selected note shows the placeholder and isn’t decrypted', async () => {
    await renderEditor()

    expectHidden()
    expect(screen.getByRole('button', { name: 'Show note' })).toBeTruthy()
    expect(ipc.get).not.toHaveBeenCalled()
  })

  it('Show note decrypts and shows the note', async () => {
    await renderEditor()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show note' })))
    await settle()

    expect(ipc.get).toHaveBeenCalledExactlyOnceWith('a')
    expect((screen.getByRole('textbox', { name: 'Note title' }) as HTMLInputElement).value).toBe(
      SECRET_TITLE
    )
    expect(document.querySelector('.cm-editor')?.textContent).toContain(SECRET_BODY)
    expect(screen.queryByText('This note is hidden')).toBeNull()
  })

  it('pin and the note actions stay available while the note is hidden', async () => {
    const crypto = { id: 'tag-1', name: 'crypto', color: '#f59e0b', createdAt: 0 }
    useVaultStore.setState({ tags: [crypto], noteTagsMap: { a: [crypto.id] } })
    await renderEditor()

    // The note's tags stay, masked like everywhere else.
    expect(screen.getByRole('button', { name: 'Remove hidden tag' })).toBeTruthy()
    expect(document.body.innerHTML).not.toContain('crypto')

    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Duplicate',
      'Export note…',
      'Move to trash'
    ])

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pin' })))
    expect(ipc.update).toHaveBeenCalledExactlyOnceWith('a', { isPinned: true })
    expect(ipc.get).not.toHaveBeenCalled()
  })

  it('while a note decrypts, the header shows no tags or note actions, as with privacy mode off', async () => {
    usePrefsStore.setState({ privacyMode: false })
    const crypto = { id: 'tag-1', name: 'crypto', color: '#f59e0b', createdAt: 0 }
    useVaultStore.setState({ tags: [crypto], noteTagsMap: { a: [crypto.id] } })
    ipc.get.mockImplementation(() => new Promise(() => {}))
    await renderEditor()

    expect(screen.getByText('Decrypting note…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Remove tag/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull()
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Move to trash'])
  })

  it('selecting another note hides the revealed one, and it stays hidden when selected again', async () => {
    await renderEditor()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show note' })))
    await settle()
    expect(screen.queryByText('This note is hidden')).toBeNull()

    await act(async () => useVaultStore.setState({ activeNoteId: 'b' }))
    await settle()
    expect(screen.getByText('This note is hidden')).toBeTruthy()

    await act(async () => useVaultStore.setState({ activeNoteId: 'a' }))
    await settle()
    expectHidden()
    // Only the one reveal decrypted it.
    expect(ipc.get).toHaveBeenCalledOnce()
  })

  it('a note still decrypting when another one is selected never reaches the editor', async () => {
    let releaseLoad = (): void => {}
    ipc.get.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          releaseLoad = () => resolve({ success: true, data: notes[id] })
        })
    )
    await renderEditor()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show note' })))

    await act(async () => useVaultStore.setState({ activeNoteId: 'b' }))
    await act(async () => releaseLoad())
    await settle()

    expectHidden()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pin' })))
    expect(ipc.update).toHaveBeenCalledExactlyOnceWith('b', { isPinned: true })
  })

  it('turning privacy mode on hides an open note and saves its pending edits first', async () => {
    await renderEditor()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show note' })))
    await settle()
    // Off and on again, with an edit still inside the autosave delay.
    await act(() => togglePrivacyMode())
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'Seed phrases, old wallet' }
    })
    expect(ipc.update).not.toHaveBeenCalled()

    await act(() => togglePrivacyMode())
    await settle()

    expectHidden()
    expect(ipc.update).toHaveBeenCalledExactlyOnceWith('a', { title: 'Seed phrases, old wallet' })
  })

  it('a note created with privacy mode on opens revealed and keeps the keys typed after the shortcut', async () => {
    const created = { ...item('n', ''), content: '' }
    let releaseLoad = (): void => {}
    ipc.get.mockImplementation((id: string) =>
      id === 'n'
        ? new Promise((resolve) => {
            releaseLoad = () => resolve({ success: true, data: created })
          })
        : Promise.resolve({ success: true, data: notes[id] })
    )
    useVaultStore.setState({ createNote: vi.fn(async () => created) })
    await renderEditor()
    const { result } = renderHook(() => useCreateNote())

    await act(() => result.current())
    // Typed right after the shortcut, before the new note has loaded.
    fireEvent.keyDown(document.body, { key: 'h' })
    fireEvent.keyDown(document.body, { key: 'i' })
    await act(async () => releaseLoad())
    await settle()

    expect(ipc.get).toHaveBeenCalledExactlyOnceWith('n')
    expect(screen.queryByText('This note is hidden')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Note title' }) as HTMLInputElement).value).toBe(
      'hi'
    )
  })

  it('a duplicated note opens hidden', async () => {
    const copy = { ...item('c', `${SECRET_TITLE} (copy)`), content: SECRET_BODY }
    useVaultStore.setState({ duplicateNote: vi.fn(async () => copy) })
    await renderEditor()
    // Even from a note that was revealed: the copy has content, unlike a new note.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show note' })))
    await settle()
    const { result } = renderHook(() => useDuplicateNote())

    await act(() => result.current('a'))
    await settle()

    expect(useVaultStore.getState().activeNoteId).toBe('c')
    expectHidden()
    expect(ipc.get).not.toHaveBeenCalledWith('c')
  })

  it('the title focus asked for by a duplicate that opened hidden doesn’t go to the next note shown', async () => {
    const copy = { ...item('c', `${SECRET_TITLE} (copy)`), content: SECRET_BODY }
    useVaultStore.setState({ duplicateNote: vi.fn(async () => copy) })
    await renderEditor()
    const { result } = renderHook(() => useDuplicateNote())
    await act(() => result.current('a'))
    await settle()

    await act(async () => useVaultStore.setState({ activeNoteId: 'b' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show note' })))
    await settle()

    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Note title' }))
  })
})
