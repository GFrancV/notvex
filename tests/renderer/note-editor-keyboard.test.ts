// @vitest-environment jsdom
import { defaultKeymap } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/ipc', () => {
  const ok = (): Promise<{ success: true; data: [] }> =>
    Promise.resolve({ success: true, data: [] })
  return {
    notvex: {
      platform: 'win32',
      notes: { get: ipc.get, update: ok, list: ok, trash: ok },
      tags: { list: ok },
      noteTags: { counts: ok, all: ok },
      clipboard: { scheduleClear: ok }
    }
  }
})

// CodeMirror measures text through Range rects, which jsdom doesn't implement.
Range.prototype.getClientRects = (): DOMRectList => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect()

// Radix positions tooltips with ResizeObserver, which jsdom doesn't implement.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const { formattingKeymap } = await import('@/lib/editor/formatting')
const { EditorToolbar } = await import('@/components/editor/EditorToolbar')
const { NoteEditor } = await import('@/components/note-editor')
const { useVaultStore } = await import('@/store/vault.store')
const { useUiStore } = await import('@/store/ui.store')

let view: EditorView | null = null

afterEach(() => {
  cleanup()
  view?.destroy()
  view = null
})

/** "hello" fully selected, with CodeMirror's own default keymap also bound. */
function editorWithSelection(): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc: 'hello',
      selection: EditorSelection.single(0, 5),
      extensions: [keymap.of(defaultKeymap), formattingKeymap]
    }),
    parent: document.body
  })
  return view
}

function press(v: EditorView, init: KeyboardEventInit): void {
  v.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  )
}

describe('formattingKeymap', () => {
  it.each([
    ['Ctrl+B → bold', { key: 'b', keyCode: 66, ctrlKey: true }, '**hello**'],
    [
      'Ctrl+I → italic, over CodeMirror selectParentSyntax',
      { key: 'i', keyCode: 73, ctrlKey: true },
      '*hello*'
    ],
    ['Ctrl+E → inline code', { key: 'e', keyCode: 69, ctrlKey: true }, '`hello`'],
    ['Ctrl+Shift+1 → h1', { key: '!', keyCode: 49, ctrlKey: true, shiftKey: true }, '# hello'],
    [
      'Ctrl+Shift+2 → h2 (US @)',
      { key: '@', keyCode: 50, ctrlKey: true, shiftKey: true },
      '## hello'
    ],
    [
      'Ctrl+Shift+2 → h2 (ES ")',
      { key: '"', keyCode: 50, ctrlKey: true, shiftKey: true },
      '## hello'
    ],
    ['Ctrl+Shift+3 → h3', { key: '#', keyCode: 51, ctrlKey: true, shiftKey: true }, '### hello'],
    [
      'Ctrl+Shift+8 → bullet list (US *)',
      { key: '*', keyCode: 56, ctrlKey: true, shiftKey: true },
      '- hello'
    ],
    [
      'Ctrl+Shift+8 → bullet list (ES ()',
      { key: '(', keyCode: 56, ctrlKey: true, shiftKey: true },
      '- hello'
    ],
    [
      'Ctrl+Shift+9 → checklist',
      { key: '(', keyCode: 57, ctrlKey: true, shiftKey: true },
      '- [ ] hello'
    ],
    [
      'Ctrl+Shift+. → quote (US >)',
      { key: '>', keyCode: 190, ctrlKey: true, shiftKey: true },
      '> hello'
    ],
    [
      'Ctrl+Shift+. → quote (ES :)',
      { key: ':', keyCode: 190, ctrlKey: true, shiftKey: true },
      '> hello'
    ]
  ] satisfies [string, KeyboardEventInit, string][])('%s', (_name, init, expected) => {
    const v = editorWithSelection()
    press(v, init)
    expect(v.state.doc.toString()).toBe(expected)
  })
})

describe('EditorToolbar', () => {
  const labels = [
    'Bold',
    'Italic',
    'Inline code',
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Bullet list',
    'Checklist',
    'Quote'
  ]

  it('gives every button an accessible name', () => {
    render(createElement(EditorToolbar, { editorView: null }))
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(labels)
  })

  it('shows the keyboard shortcut in the tooltip', async () => {
    render(createElement(EditorToolbar, { editorView: null }))
    fireEvent.focus(screen.getByRole('button', { name: 'Heading 2' }))
    expect((await screen.findByRole('tooltip')).textContent).toBe('Heading 2 Ctrl+Shift+2')
  })

  it('tells the user how to Tab out of the editor', async () => {
    render(createElement(EditorToolbar, { editorView: null }))
    fireEvent.focus(screen.getByRole('button', { name: 'Quote' }))
    expect((await screen.findByRole('tooltip')).textContent).toContain('Ctrl+M')
  })
})

describe('NoteEditor — focus after opening a note', () => {
  const titleInput = (): HTMLElement => screen.getByLabelText('Note title')
  const editorHasFocus = (): boolean =>
    document.activeElement?.classList.contains('cm-content') ?? false

  function serve(id: string, title: string): void {
    ipc.get.mockResolvedValue({
      success: true,
      data: {
        id,
        title,
        content: 'body',
        isPinned: false,
        isTrashed: false,
        createdAt: 0,
        updatedAt: 0,
        trashedAt: null,
        tags: []
      }
    })
  }

  /** What useCreateNote does once the note exists. */
  function createNote(id: string): void {
    serve(id, 'Untitled')
    act(() => {
      useVaultStore.getState().setActiveNoteId(id)
      useUiStore.getState().requestFocusTitle()
    })
  }

  beforeEach(() => {
    useVaultStore.setState({ activeNoteId: null, notes: [], tags: [], noteTagsMap: {} })
    useUiStore.setState({ editorMode: 'editing' })
    // In Electron the next frame can fire before React commits the loaded note; jsdom's
    // 16ms frame always loses that race, so run frames as microtasks to match the app.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      queueMicrotask(() => cb(0))
      return 0
    })
  })

  afterEach(() => {
    vi.mocked(window.requestAnimationFrame).mockRestore()
  })

  it('focuses the title of a note created from the empty state', async () => {
    render(createElement(NoteEditor))
    createNote('n')
    await waitFor(() => expect(document.activeElement).toBe(titleInput()))
  })

  it('focuses the title of a note created while another note is open', async () => {
    serve('a', 'A')
    act(() => useVaultStore.getState().setActiveNoteId('a'))
    render(createElement(NoteEditor))
    await waitFor(() => expect(editorHasFocus()).toBe(true))

    createNote('n')
    await waitFor(() => expect(document.activeElement).toBe(titleInput()))
  })

  it('focuses the editor when an existing note is opened', async () => {
    render(createElement(NoteEditor))
    serve('a', 'A')
    act(() => useVaultStore.getState().setActiveNoteId('a'))
    await waitFor(() => expect((titleInput() as HTMLInputElement).value).toBe('A'))
    expect(editorHasFocus()).toBe(true)
  })

  it('ignores title-focus requests made before the editor mounted', async () => {
    // A request already handled by a previous instance, e.g. one unmounted by a lock.
    useUiStore.setState({ focusTitleRequest: 3 })
    render(createElement(NoteEditor))
    serve('a', 'A')
    act(() => useVaultStore.getState().setActiveNoteId('a'))
    await waitFor(() => expect((titleInput() as HTMLInputElement).value).toBe('A'))
    expect(editorHasFocus()).toBe(true)
  })
})
