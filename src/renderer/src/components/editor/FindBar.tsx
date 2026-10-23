import { type ReactNode, useMemo } from 'react'

import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search'
import type { EditorState, Text } from '@codemirror/state'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react'

import { Button } from '../ui/button'
import { Input } from '../ui/input'

type Match = { from: number; to: number }

function findMatches(query: SearchQuery, doc: Text): Match[] {
  const matches: Match[] = []
  if (!query.valid) return matches
  const cursor = query.getCursor(doc)
  for (let next = cursor.next(); !next.done; next = cursor.next()) matches.push(next.value)
  return matches
}

function counterLabel(query: SearchQuery, matches: Match[], current: number): string | null {
  if (!query.search) return null
  if (matches.length === 0) return 'No results'
  return `${current} / ${matches.length}`
}

export function FindBar({ view, state }: { view: EditorView; state: EditorState }): ReactNode {
  const query = getSearchQuery(state)
  // Both are immutable and change identity only when edited, so selection-only updates don't rescan.
  const matches = useMemo(() => findMatches(query, state.doc), [query, state.doc])
  const { from, to } = state.selection.main
  const current = matches.findIndex((m) => m.from === from && m.to === to) + 1
  const counter = counterLabel(query, matches, current)

  const handleChange = (search: string): void => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, literal: true })) })
  }

  // Input only: on a focused button, Enter already clicks it.
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    // Keeps the panel handler below from also seeing it.
    e.stopPropagation()
    if (e.shiftKey) findPrevious(view)
    else findNext(view)
  }

  // On the whole bar, so Escape also closes it from a focused button. Escape, F3 and Mod-g come from
  // searchKeymap's "search-panel" scope, as in CodeMirror's own panel.
  const handlePanelKeyDown = (e: React.KeyboardEvent): void => {
    if (runScopeHandlers(view, e.nativeEvent, 'search-panel')) e.preventDefault()
  }

  return (
    <search className="flex items-center gap-2 px-6.5 py-1.5" onKeyDown={handlePanelKeyDown}>
      <Input
        // openSearchPanel focuses the panel's [main-field] element.
        main-field="true"
        aria-label="Find in note"
        placeholder="Find"
        value={query.search}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleInputKeyDown}
        className="h-7 max-w-64"
      />
      {counter && (
        <span aria-live="polite" className="text-muted-foreground min-w-16 text-xs tabular-nums">
          {counter}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        onClick={() => findPrevious(view)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next match"
        title="Next match (Enter)"
        onClick={() => findNext(view)}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Close find"
        title="Close (Esc)"
        className="ml-auto"
        onClick={() => {
          closeSearchPanel(view)
          // closeSearchPanel refocuses the editor only if focus is inside the bar, and a click
          // doesn't always leave it on the button.
          view.focus()
        }}
      >
        {/* Same color as the chevrons, but its full-height strokes read brighter at the same size. */}
        <XIcon className="size-2.5" />
      </Button>
    </search>
  )
}
