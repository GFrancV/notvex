import { type ReactNode, useState } from 'react'

import {
  BookOpenIcon,
  BugIcon,
  CircleHelpIcon,
  CopyIcon,
  FolderOpenIcon,
  InfoIcon,
  Trash2Icon
} from 'lucide-react'

import { ClearLogsDialog } from '@/components/dialogs/ClearLogsDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { DOCS_URL, loadReportParts, openBugReport, reportBody } from '@/lib/bug-report'
import { notvex } from '@/lib/ipc'

interface Props {
  onOpenAbout: () => void
}

// The window's menu bar is hidden on Windows and Linux, so this stands in for a desktop app's
// Help menu: documentation first, then diagnostics, About last.
export function HelpMenu({ onOpenAbout }: Props): ReactNode {
  const { copyToClipboard } = useCopyToClipboard()
  const [clearLogsOpen, setClearLogsOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="titlebar-no-drag z-50" aria-label="Help">
            <CircleHelpIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" sideOffset={4} className="w-56">
          <DropdownMenuItem onClick={() => void notvex.shell.openExternal(DOCS_URL)}>
            <BookOpenIcon />
            Documentation
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void openBugReport()}>
              <BugIcon />
              Report a bug…
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => copyToClipboard(reportBody(await loadReportParts()))}
            >
              <CopyIcon />
              Copy debug info
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void notvex.log.openFolder()}>
              <FolderOpenIcon />
              Open logs folder
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setClearLogsOpen(true)}>
              <Trash2Icon />
              Clear logs…
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenAbout}>
            <InfoIcon />
            About Notvex
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ClearLogsDialog open={clearLogsOpen} onOpenChange={setClearLogsOpen} />
    </>
  )
}
