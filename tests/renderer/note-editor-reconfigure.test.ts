// @vitest-environment jsdom
import { createElement } from 'react'

import { language } from '@codemirror/language'
import { StateEffect, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act, cleanup, render, waitFor } from '@testing-library/react'
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

const note: Note = {
  id: 'a',
  title: 'A',
  content: '# Heading\n\nSome **bold** text.',
  isPinned: false,
  isTrashed: false,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null,
  tags: []
}

const editorView = (): EditorView =>
  EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!

// jsdom has no layout, and the real CodeMirror measures ranges.
beforeAll(() => {
  Range.prototype.getClientRects = (): DOMRectList => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect()
})

afterEach(() => cleanup())

describe('NoteEditor — typing', () => {
  // A reconfigure swaps in a new markdown Language, which throws away the syntax tree and
  // reparses the whole note: in a long note that lags each keystroke and blanks the live preview.
  it('keeps the same markdown language instead of reconfiguring the editor', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note })
    useVaultStore.setState({ activeNoteId: 'a', notes: [], tags: [], noteTagsMap: {} })
    render(createElement(NoteEditor))
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull())

    const view = editorView()
    const before = view.state.facet(language)
    const dispatch = vi.spyOn(view, 'dispatch')
    for (const ch of 'abc') {
      act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ch } }))
    }

    expect(view.state.doc.toString()).toBe(`${note.content}abc`)
    // @uiw/react-codemirror reconfigures when extensions, basicSetup or onChange change identity;
    // the language check alone would miss the last two.
    const effects = dispatch.mock.calls.flatMap(([spec]) =>
      [(spec as TransactionSpec).effects ?? []].flat()
    )
    expect(effects.some((e) => e.is(StateEffect.reconfigure))).toBe(false)
    expect(view.state.facet(language)).toBe(before)
  }, 20_000)
})
