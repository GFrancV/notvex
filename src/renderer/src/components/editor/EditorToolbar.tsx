import { Fragment } from 'react'

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
  type LucideIcon,
  QuoteIcon
} from 'lucide-react'

import { type FormattingAction, formattingShortcuts, toolbarActions } from '@/lib/editor/formatting'
import { notvex } from '@/lib/ipc'
import { Button } from '../ui/button'
import { Kbd } from '../ui/kbd'
import { Separator } from '../ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

const groups: [FormattingAction, LucideIcon][][] = [
  [
    ['bold', BoldIcon],
    ['italic', ItalicIcon],
    ['code', CodeIcon]
  ],
  [
    ['h1', Heading1Icon],
    ['h2', Heading2Icon],
    ['h3', Heading3Icon]
  ],
  [
    ['bulletList', ListIcon],
    ['checkList', CheckSquareIcon],
    ['quote', QuoteIcon]
  ]
]

const isMac = notvex.platform === 'darwin'

/** CodeMirror key notation ("Mod-Shift-1") to what the user presses ("Ctrl+Shift+1"). */
function displayKey(key: string): string {
  return key
    .replace('Mod', isMac ? '⌘' : 'Ctrl')
    .split('-')
    .map((part) => (part.length === 1 ? part.toUpperCase() : part))
    .join('+')
}

// indentWithTab keeps Tab inside the editor; CodeMirror's tab-focus mode is the way out.
const tabOutHint = `${isMac ? 'Shift+Option+M' : 'Ctrl+M'}, then Shift+Tab, leaves the editor`

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
    <TooltipProvider delayDuration={500}>
      <div className="bg-card text-muted-foreground flex items-center gap-0.5 border-y px-6.5 py-1.75">
        {groups.map((group, i) => (
          <Fragment key={group[0][0]}>
            {i > 0 && <Separator orientation="vertical" className="mx-1.5" />}
            {group.map(([action, Icon]) => {
              const { label, key } = formattingShortcuts[action]
              return (
                <Tooltip key={action}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={label}
                      onClick={act(toolbarActions[action])}
                    >
                      <Icon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {label} <Kbd>{displayKey(key)}</Kbd>
                    {action === 'quote' && <p className="mt-1">{tabOutHint}</p>}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </Fragment>
        ))}
      </div>
    </TooltipProvider>
  )
}
