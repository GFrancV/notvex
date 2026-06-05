import type { EditorView } from '@codemirror/view'

function wrapSelection(view: EditorView, before: string, after: string): void {
  const { state } = view
  const { from, to } = state.selection.main
  if (from === to) {
    const placeholder = 'text'
    view.dispatch({
      changes: { from, insert: before + placeholder + after },
      selection: { anchor: from + before.length, head: from + before.length + placeholder.length },
    })
  } else {
    const selected = state.sliceDoc(from, to)
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    })
  }
  view.focus()
}

function prefixLine(view: EditorView, prefix: string): void {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  view.dispatch({
    changes: { from: line.from, insert: prefix },
    selection: { anchor: line.from + prefix.length },
  })
  view.focus()
}

export const toolbarActions: Record<string, (v: EditorView) => void> = {
  bold: (v: EditorView): void => wrapSelection(v, '**', '**'),
  italic: (v: EditorView): void => wrapSelection(v, '*', '*'),
  code: (v: EditorView): void => wrapSelection(v, '`', '`'),
  quote: (v: EditorView): void => prefixLine(v, '> '),
  bulletList: (v: EditorView): void => prefixLine(v, '- '),
  checkList: (v: EditorView): void => prefixLine(v, '- [ ] '),
  h1: (v: EditorView): void => prefixLine(v, '# '),
  h2: (v: EditorView): void => prefixLine(v, '## '),
  h3: (v: EditorView): void => prefixLine(v, '### '),
}
