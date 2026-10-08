// @vitest-environment jsdom
import { defaultKeymap } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ipc', () => ({ notvex: { platform: 'win32' } }))

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
