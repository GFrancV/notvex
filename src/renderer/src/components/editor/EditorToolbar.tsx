import type { EditorView } from '@codemirror/view'
import {
  BoldIcon,
  CheckSquareIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  ListIcon,
  QuoteIcon
} from 'lucide-react'

import { toolbarActions } from '@/lib/editor/formatting'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'

export function EditorToolbar({
  editorView
}: {
  editorView: EditorView | null
}): React.JSX.Element | null {
  const act =
    (fn: (v: EditorView) => void): (() => void) =>
    () => {
      if (editorView) fn(editorView)
    }

  return (
    <div className="bg-card text-muted-foreground flex items-center gap-0.5 border-y px-6.5 py-1.75">
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.bold)}>
        <BoldIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.italic)}>
        <ItalicIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.code)}>
        <CodeIcon />
      </Button>
      <Separator orientation="vertical" className="mx-1.5" />
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.h1)}>
        <Heading1Icon />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.h2)}>
        <Heading2Icon />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.h3)}>
        <Heading3Icon />
      </Button>
      <Separator orientation="vertical" className="mx-1.5" />
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.bulletList)}>
        <ListIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.checkList)}>
        <CheckSquareIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={act(toolbarActions.quote)}>
        <QuoteIcon />
      </Button>
    </div>
  )
}
