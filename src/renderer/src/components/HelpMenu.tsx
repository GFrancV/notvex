import type { ReactNode } from 'react'

import {
  BookOpenIcon,
  BugIcon,
  CircleHelpIcon,
  CopyIcon,
  ExternalLinkIcon,
  InfoIcon
} from 'lucide-react'

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
import { DOCS_URL, loadDebugInfo, openBugReport } from '@/lib/bug-report'
import { notvex } from '@/lib/ipc'

interface Props {
  onOpenAbout: () => void
}

// The window's menu bar is hidden on Windows and Linux, so this stands in for a desktop app's
// Help menu: documentation first, then bug reporting, About last. Log management lives in
// Settings → Diagnostics.
export function HelpMenu({ onOpenAbout }: Props): ReactNode {
  const { copyToClipboard } = useCopyToClipboard()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="titlebar-no-drag z-50" aria-label="Help">
          <CircleHelpIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" sideOffset={4} className="w-56">
        <DropdownMenuItem
          onClick={() => void notvex.shell.openExternal(DOCS_URL)}
          aria-label="Documentation (opens in your browser)"
        >
          <BookOpenIcon />
          Documentation
          <ExternalLinkIcon className="ml-auto" aria-hidden />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => void openBugReport()}
            aria-label="Report a bug (opens in your browser)"
          >
            <BugIcon />
            Report a bug
            <ExternalLinkIcon className="ml-auto" aria-hidden />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={async () => copyToClipboard(await loadDebugInfo())}>
            <CopyIcon />
            Copy debug info
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenAbout}>
          <InfoIcon />
          About Notvex
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
