import { Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'

function wrapSelection(view: EditorView, before: string, after: string): void {
  const { state } = view
  const { from, to } = state.selection.main
  if (from === to) {
    const placeholder = 'text'
    view.dispatch({
      changes: { from, insert: before + placeholder + after },
      selection: { anchor: from + before.length, head: from + before.length + placeholder.length }
    })
  } else {
    const selected = state.sliceDoc(from, to)
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length, head: from + before.length + selected.length }
    })
  }
  view.focus()
}

function prefixLine(view: EditorView, prefix: string): void {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  view.dispatch({
    changes: { from: line.from, insert: prefix },
    selection: { anchor: line.from + prefix.length }
  })
  view.focus()
}

export const toolbarActions = {
  bold: (v: EditorView): void => wrapSelection(v, '**', '**'),
  italic: (v: EditorView): void => wrapSelection(v, '*', '*'),
  code: (v: EditorView): void => wrapSelection(v, '`', '`'),
  quote: (v: EditorView): void => prefixLine(v, '> '),
  bulletList: (v: EditorView): void => prefixLine(v, '- '),
  checkList: (v: EditorView): void => prefixLine(v, '- [ ] '),
  h1: (v: EditorView): void => prefixLine(v, '# '),
  h2: (v: EditorView): void => prefixLine(v, '## '),
  h3: (v: EditorView): void => prefixLine(v, '### ')
}

export type FormattingAction = keyof typeof toolbarActions

// Headings use Shift, not Alt: Ctrl+Alt is AltGr on Windows, so Mod-Alt-1 would be
// unreachable on layouts that type characters with AltGr+digit.
export const formattingShortcuts: Record<FormattingAction, { label: string; key: string }> = {
  bold: { label: 'Bold', key: 'Mod-b' },
  italic: { label: 'Italic', key: 'Mod-i' },
  code: { label: 'Inline code', key: 'Mod-e' },
  h1: { label: 'Heading 1', key: 'Mod-Shift-1' },
  h2: { label: 'Heading 2', key: 'Mod-Shift-2' },
  h3: { label: 'Heading 3', key: 'Mod-Shift-3' },
  bulletList: { label: 'Bullet list', key: 'Mod-Shift-8' },
  checkList: { label: 'Checklist', key: 'Mod-Shift-9' },
  quote: { label: 'Quote', key: 'Mod-Shift-.' }
}

// High precedence: CodeMirror's defaultKeymap binds Mod-i to selectParentSyntax.
// stopPropagation: window-level shortcuts (the sidebar's Mod-b) must not also fire.
export const formattingKeymap = Prec.high(
  keymap.of(
    (Object.keys(formattingShortcuts) as FormattingAction[]).map((action) => ({
      key: formattingShortcuts[action].key,
      stopPropagation: true,
      run: (v: EditorView): boolean => {
        toolbarActions[action](v)
        return true
      }
    }))
  )
)
