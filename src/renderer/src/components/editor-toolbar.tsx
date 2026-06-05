import type { ReactNode } from 'react'

import type { EditorView } from '@codemirror/view'
import { Bold, Italic, Code, Quote, List, CheckSquare } from 'lucide-react'

import { toolbarActions } from '../lib/editor/formatting'

interface EditorToolbarProps {
  editorView: EditorView | null
}

interface ToolbarButtonProps {
  onClick: () => void
  title: string
  children: ReactNode
  label?: string
}

function ToolbarButton({ onClick, title, children, label }: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault() // prevent stealing focus from editor
        onClick()
      }}
      title={title}
      className="flex h-6 items-center gap-1 rounded px-1.5 text-[#737373] transition-colors hover:text-emerald-400 focus:outline-none"
    >
      {children}
      {label && <span className="text-xs font-medium">{label}</span>}
    </button>
  )
}

function Divider(): JSX.Element {
  return <span className="mx-1 h-3.5 w-px bg-[#2a2a2a]" />
}

export function EditorToolbar({ editorView }: EditorToolbarProps): JSX.Element {
  const act = (fn: (v: EditorView) => void): (() => void) => () => {
    if (editorView) fn(editorView)
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-[#1e1e1e] bg-[#0f0f0f] px-3 py-0.5">
      <ToolbarButton onClick={act(toolbarActions.h1)} title="Heading 1" label="H1" />
      <ToolbarButton onClick={act(toolbarActions.h2)} title="Heading 2" label="H2" />
      <ToolbarButton onClick={act(toolbarActions.h3)} title="Heading 3" label="H3" />

      <Divider />

      <ToolbarButton onClick={act(toolbarActions.bold)} title="Bold (wrap selection in **)">
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={act(toolbarActions.italic)} title="Italic (wrap selection in *)">
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={act(toolbarActions.code)} title="Inline code">
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton onClick={act(toolbarActions.quote)} title="Blockquote">
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={act(toolbarActions.bulletList)} title="Bullet list">
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={act(toolbarActions.checkList)} title="Task / checklist">
        <CheckSquare className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  )
}
