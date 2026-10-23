import type { ReactNode } from 'react'

import { type EditorView, runScopeHandlers } from '@codemirror/view'

import { Input } from '../ui/input'

export function FindBar({ view }: { view: EditorView }): ReactNode {
  // Escape, F3 and Mod-g come from searchKeymap's "search-panel" scope, as in CodeMirror's own panel.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (runScopeHandlers(view, e.nativeEvent, 'search-panel')) e.preventDefault()
  }

  return (
    <div className="flex items-center gap-2 px-6.5 py-1.5">
      <Input
        // openSearchPanel focuses the panel's [main-field] element.
        main-field="true"
        aria-label="Find in note"
        placeholder="Find"
        onKeyDown={handleKeyDown}
        className="h-7 max-w-64"
      />
    </div>
  )
}
