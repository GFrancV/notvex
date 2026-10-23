import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { search } from '@codemirror/search'
import type { EditorState } from '@codemirror/state'
import { EditorView, type Panel } from '@codemirror/view'

import { FindBar } from '@/components/editor/FindBar'

function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  const root = createRoot(dom)
  const render = (state: EditorState): void => root.render(<FindBar view={view} state={state} />)
  return {
    dom,
    top: true,
    mount: () => {
      // Synchronous, so the input exists to be focused here and for searchKeymap's Mod-f.
      flushSync(() => render(view.state))
      const input = dom.querySelector<HTMLInputElement>('[main-field]')
      input?.focus()
      input?.select()
    },
    update: (update) => render(update.state),
    // Deferred: the panel is destroyed mid-update, and React can't unmount a root synchronously
    // while it may be rendering.
    destroy: () => queueMicrotask(() => root.unmount())
  }
}

// !important: CodeMirror's dark base theme uses more specific selectors, and the One Dark theme that
// theme="dark" adds is injected later with the same specificity (and a blue outline on every match).
const findTheme = EditorView.theme({
  '.cm-panels': {
    backgroundColor: 'var(--card) !important',
    color: 'var(--card-foreground) !important'
  },
  '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  // A light fill keeps the text inside readable; the current match gets a solid outline as well,
  // since no translucent fill reaches 3:1 against the dark background without hurting the text.
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--warning) 25%, transparent) !important',
    outline: 'none !important'
  },
  '.cm-searchMatch-selected': { outline: '1px solid var(--warning) !important' }
})

// CodeMirror only highlights matches while its search panel is open, so the find bar is that panel.
// literal: the query is plain text, so a backslash in it (C:\temp) isn't read as an escape.
export const findExtension = [
  search({ top: true, literal: true, createPanel: createFindPanel }),
  findTheme
]
