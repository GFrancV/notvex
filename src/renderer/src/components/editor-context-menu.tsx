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
  PaintbrushIcon,
  PilcrowIcon,
  QuoteIcon
} from 'lucide-react'
import type { JSX, ReactNode } from 'react'

import { toolbarActions } from '@/lib/editor/formatting'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from './ui/context-menu'

interface EditorContextMenuProps {
  editorView: EditorView | null
  children: ReactNode
}

export function EditorContextMenu({ editorView, children }: EditorContextMenuProps): JSX.Element {
  const act =
    (fn: (v: EditorView) => void): (() => void) =>
    () => {
      if (editorView) fn(editorView)
    }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="h-full w-full min-w-0 overflow-auto">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <PaintbrushIcon />
            Format
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuGroup>
              <ContextMenuItem onClick={act(toolbarActions.bold)}>
                <BoldIcon />
                Bold
              </ContextMenuItem>
              <ContextMenuItem onClick={act(toolbarActions.italic)}>
                <ItalicIcon />
                Italic
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem onClick={act(toolbarActions.code)}>
                <CodeIcon />
                Inline Code
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <PilcrowIcon />
            Paragraph
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuGroup>
              <ContextMenuItem onClick={act(toolbarActions.bulletList)}>
                <ListIcon />
                Bullet list
              </ContextMenuItem>
              <ContextMenuItem onClick={act(toolbarActions.checkList)}>
                <CheckSquareIcon />
                Task list
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem onClick={act(toolbarActions.h1)}>
                <Heading1Icon />
                Heading 1
              </ContextMenuItem>
              <ContextMenuItem onClick={act(toolbarActions.h2)}>
                <Heading2Icon />
                Heading 2
              </ContextMenuItem>
              <ContextMenuItem onClick={act(toolbarActions.h3)}>
                <Heading3Icon />
                Heading 3
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem onClick={act(toolbarActions.quote)}>
                <QuoteIcon />
                Quote
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}
