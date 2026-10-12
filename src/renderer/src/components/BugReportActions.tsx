import type { ReactNode } from 'react'

import { BugIcon, CheckIcon, CopyIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { loadReportParts, openBugReport, reportBody } from '@/lib/bug-report'

// Report bug and Copy report, shared by the About dialog and the ErrorBoundary fallback.
// The report is read fresh on every click so it carries the latest log lines.
export function BugReportActions(): ReactNode {
  const { isCopied, copyToClipboard } = useCopyToClipboard()

  return (
    <div className="flex gap-2">
      <Button variant="outline" className="flex-1" onClick={() => void openBugReport()}>
        <BugIcon />
        Report bug
      </Button>
      <Button
        variant="outline"
        className="flex-1"
        onClick={async () => copyToClipboard(reportBody(await loadReportParts()))}
      >
        {isCopied ? <CheckIcon /> : <CopyIcon />}
        {isCopied ? 'Copied' : 'Copy report'}
      </Button>
    </div>
  )
}
