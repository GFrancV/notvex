// @vitest-environment jsdom
import { createElement } from 'react'

import { EditorView } from '@codemirror/view'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Note } from '@shared/types'

const ipc = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(async () => ({ success: true, data: null })),
  list: vi.fn(async () => ({ success: true, data: [] })),
  counts: vi.fn(async () => ({ success: true, data: {} }))
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    notes: { get: ipc.get, update: ipc.update, list: ipc.list, trash: vi.fn() },
    tags: { list: vi.fn(async () => ({ success: true, data: [] })) },
    noteTags: { counts: ipc.counts, all: vi.fn(async () => ({ success: true, data: [] })) }
  }
}))

const { NoteEditor } = await import('@/components/note-editor')
const { useVaultStore } = await import('@/store/vault.store')

const note = (id: string, content: string): Note => ({
  id,
  title: id.toUpperCase(),
  content,
  isPinned: false,
  isTrashed: false,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null,
  tags: []
})

const editorDoc = (): string => {
  const dom = document.querySelector('.cm-editor')
  return dom ? EditorView.findFromDOM(dom as HTMLElement)!.state.doc.toString() : '<none>'
}

// The real CodeMirror runs here (the bug lives in its React wrapper), and jsdom has no layout.
beforeAll(() => {
  Range.prototype.getClientRects = (): DOMRectList => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect()
})

afterEach(() => cleanup())

describe('NoteEditor — switching notes right after typing', () => {
  it('shows the next note’s document, not the one still being typed into', async () => {
    const notes: Record<string, Note> = { a: note('a', 'alpha text'), b: note('b', 'bravo') }
    ipc.get.mockImplementation(async (id: string) => ({ success: true, data: notes[id] }))
    useVaultStore.setState({ activeNoteId: 'a', notes: [], tags: [], noteTagsMap: {} })
    render(createElement(NoteEditor), { reactStrictMode: true })
    await waitFor(() => expect(editorDoc()).toBe('alpha text'))

    // A user edit (no external-change annotation) puts @uiw/react-codemirror in its typing
    // window, during which it defers value updates coming from React.
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
    act(() => view.dispatch({ changes: { from: 0, insert: 'x' } }))

    act(() => useVaultStore.setState({ activeNoteId: 'b' }))
    await screen.findByText('1 word · 5 characters')

    // The footer reads React state; the editor must agree with it in the same commit.
    expect(editorDoc()).toBe('bravo')
    // Mounts the real CodeMirror twice under StrictMode, which is slow on a cold worker.
  }, 20_000)

  it('offers no editor to type into while the next note is still decrypting', async () => {
    const notes: Record<string, Note> = { a: note('a', 'alpha text'), b: note('b', 'bravo') }
    let releaseB = (): void => {}
    ipc.get.mockImplementation((id: string) =>
      id === 'b'
        ? new Promise((resolve) => {
            releaseB = () => resolve({ success: true, data: notes.b })
          })
        : Promise.resolve({ success: true, data: notes[id] })
    )
    useVaultStore.setState({ activeNoteId: 'a', notes: [], tags: [], noteTagsMap: {} })
    render(createElement(NoteEditor), { reactStrictMode: true })
    await waitFor(() => expect(editorDoc()).toBe('alpha text'))

    act(() => useVaultStore.setState({ activeNoteId: 'b' }))
    // An editor here would take focus, and a keystroke into its empty document would be
    // autosaved over 'b' once the real content arrived.
    expect(document.querySelector('.cm-editor')).toBeNull()

    act(() => releaseB())
    await waitFor(() => expect(editorDoc()).toBe('bravo'))
    // The earlier test's pending save for 'a' may still flush here; only 'b' matters.
    expect(ipc.update).not.toHaveBeenCalledWith('b', expect.anything())
  }, 20_000)
})
