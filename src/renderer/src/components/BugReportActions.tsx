import type { ReactNode } from 'react'

import { CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { loadDebugInfo, openBugReport } from '@/lib/bug-report'

// Report a bug and Copy debug info for the ErrorBoundary fallback, which has no menu to reach.
// The report is read fresh on every click so it carries the latest log lines.
export function BugReportActions(): ReactNode {
  const { isCopied, copyToClipboard } = useCopyToClipboard()

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        className="flex-1"
        onClick={() => void openBugReport()}
        aria-label="Report a bug (opens in your browser)"
      >
        Report a bug
        <ExternalLinkIcon aria-hidden />
      </Button>
      <Button
        variant="outline"
        className="flex-1"
        onClick={async () => copyToClipboard(await loadDebugInfo())}
      >
        {isCopied ? <CheckIcon className="text-success" /> : <CopyIcon />}
        {isCopied ? 'Copied' : 'Copy debug info'}
      </Button>
    </div>
  )
}
