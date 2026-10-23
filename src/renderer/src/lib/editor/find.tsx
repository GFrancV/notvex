import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { search } from '@codemirror/search'
import type { EditorView, Panel } from '@codemirror/view'

import { FindBar } from '@/components/editor/FindBar'

function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  const root = createRoot(dom)
  return {
    dom,
    top: true,
    mount: () => {
      // Synchronous, so the input exists to be focused here and for searchKeymap's Mod-f.
      flushSync(() => root.render(<FindBar view={view} />))
      const input = dom.querySelector<HTMLInputElement>('[main-field]')
      input?.focus()
      input?.select()
    },
    // Deferred: the panel is destroyed mid-update, and React can't unmount a root synchronously
    // while it may be rendering.
    destroy: () => queueMicrotask(() => root.unmount())
  }
}

// CodeMirror only highlights matches while its search panel is open, so the find bar is that panel.
export const findExtension = search({ top: true, createPanel: createFindPanel })
