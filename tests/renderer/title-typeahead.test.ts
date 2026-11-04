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

import type { Note } from '@shared/types'

const ipc = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), update: vi.fn() }))

// CodeMirror carries no weight for the title path and is expensive in jsdom.
vi.mock('@uiw/react-codemirror', () => ({ default: (): null => null }))

vi.mock('@/lib/ipc', () => {
  const ok = async (): Promise<{ success: true; data: [] }> => ({ success: true, data: [] })
  return {
    notvex: {
      platform: 'win32',
      notes: {
        create: ipc.create,
        get: ipc.get,
        update: ipc.update,
        list: ok,
        counts: async () => ({ success: true, data: { live: 0, pinned: 0, trashed: 0 } })
      },
      tags: { list: ok },
      noteTags: { counts: ok, all: ok }
    }
  }
})

const { NoteEditor } = await import('@/components/note-editor')
const { useCreateNote } = await import('@/hooks/use-create-note')
const { startTypeahead } = await import('@/lib/title-typeahead')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

function note(id: string, title: string): Note {
  return {
    id,
    title,
    content: '',
    isPinned: false,
    isTrashed: false,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags: []
  }
}

const titleInput = (): HTMLInputElement => screen.getByLabelText('Note title')

/** Types each character as a keydown; true when every key was cancelled. */
function type(text: string): boolean {
  return [...text]
    .map((key) => fireEvent.keyDown(document.activeElement ?? document.body, { key }))
    .every((delivered) => !delivered)
}

/** Starts a create whose IPC round trip stays open until the returned function runs. */
function startCreate(id: string, title: string): () => Promise<void> {
  let resolve!: (v: unknown) => void
  ipc.create.mockReturnValueOnce(new Promise((r) => (resolve = r)))
  ipc.get.mockResolvedValue({ success: true, data: note(id, title) })
  const { result } = renderHook(() => useCreateNote())
  let done!: Promise<void>
  act(() => {
    done = result.current()
  })
  return async () => {
    await act(async () => {
      resolve({ success: true, data: { ...note(id, title), tagIds: [] } })
      await done
    })
  }
}

beforeEach(() => {
  ipc.create.mockReset()
  ipc.get.mockReset()
  ipc.update.mockReset().mockResolvedValue({ success: true, data: null })
  useVaultStore.setState({ activeNoteId: null, notes: [], tags: [], noteTagsMap: {} })
  useUiStore.setState({ searchQuery: '', showTrash: false, editorMode: 'editing' })
})

afterEach(cleanup)

describe('keys typed before a new note opens', () => {
  it('become its title and are saved', async () => {
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    const finish = startCreate('n', 'Untitled')
    expect(type('Titulo')).toBe(true)
    await finish()

    await waitFor(() => expect(titleInput().value).toBe('Titulo'))
    expect(document.activeElement).toBe(titleInput())
    expect(titleInput().selectionStart).toBe('Titulo'.length)
    await waitFor(() => expect(ipc.update).toHaveBeenCalledWith('n', { title: 'Titulo' }))
  })

  it('never reach the note that was open before', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a', 'A') })
    act(() => useVaultStore.getState().setActiveNoteId('a'))
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await waitFor(() => expect(titleInput().value).toBe('A'))
    act(() => titleInput().focus())

    const finish = startCreate('n', 'Untitled')
    // Backspace or Ctrl+V pass through capture: with nothing focused they edit nothing.
    expect(document.activeElement).toBe(document.body)
    expect(type('Titulo')).toBe(true)
    await finish()

    await waitFor(() => expect(titleInput().value).toBe('Titulo'))
    expect(ipc.update).not.toHaveBeenCalledWith('a', expect.anything())
  })

  it('are in the title as soon as the note loads, before keys typed later arrive', async () => {
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    let resolveGet!: (v: unknown) => void
    const finish = startCreate('n', 'Untitled')
    ipc.get.mockReturnValueOnce(new Promise((r) => (resolveGet = r)))
    type('Ti')
    await finish()
    // The note exists but is still loading: its title input isn't there yet.
    type('tu')

    // Outside act: React gets no chance to render scheduled updates before the check.
    resolveGet({ success: true, data: note('n', 'Untitled') })
    await Promise.resolve()
    await Promise.resolve()
    expect(titleInput().value).toBe('Titu')
    expect(document.activeElement).toBe(titleInput())
  })

  it('keep what was typed when a second create starts before the note opens', async () => {
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    const finish = startCreate('n', 'Untitled')
    type('ab')
    startTypeahead()
    type('cd')
    await finish()

    await waitFor(() => expect(titleInput().value).toBe('abcd'))
  })

  it('replace a title taken from the search query', async () => {
    useUiStore.setState({ searchQuery: 'foo' })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    const finish = startCreate('n', 'foo')
    type('Titulo')
    await finish()

    await waitFor(() => expect(titleInput().value).toBe('Titulo'))
  })

  it('leave shortcuts and non-printable keys alone, but keep AltGr characters', async () => {
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    const finish = startCreate('n', 'Untitled')
    const target = document.activeElement ?? document.body
    expect(fireEvent.keyDown(target, { key: 'b', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(target, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(target, { key: 'Backspace' })).toBe(true)
    // Keys an IME is composing belong to it, not to the buffer.
    expect(fireEvent.keyDown(target, { key: 'a', isComposing: true })).toBe(true)
    expect(
      fireEvent.keyDown(target, { key: '@', ctrlKey: true, altKey: true, modifierAltGraph: true })
    ).toBe(false)
    await finish()

    await waitFor(() => expect(titleInput().value).toBe('@'))
  })
})
