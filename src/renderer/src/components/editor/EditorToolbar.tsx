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
import { Shortcut } from '../Shortcut'
import { Button } from '../ui/button'
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

// indentWithTab keeps Tab inside the editor; CodeMirror's tab-focus mode is the way out.
const tabOutKeys = notvex.platform === 'darwin' ? 'Shift-Alt-m' : 'Mod-m'

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
                    {label} <Shortcut keys={key} />
                    {action === 'quote' && (
                      <p className="mt-1">
                        <Shortcut keys={tabOutKeys} />, then <Shortcut keys="Shift-Tab" />, leaves
                        the editor
                      </p>
                    )}
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
