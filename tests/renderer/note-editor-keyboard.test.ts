// @vitest-environment jsdom
import { defaultKeymap } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { formattingKeymap } from '@/lib/editor/formatting'

let view: EditorView | null = null

afterEach(() => {
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
