import type { BugReportParts } from '@shared/types'

import { notvex } from '@/lib/ipc'

export const DOCS_URL = 'https://github.com/GFrancV/notvex'
export const ISSUE_URL = `${DOCS_URL}/issues/new`
const ISSUE_TITLE = '[BUG] '
// Browsers and GitHub start refusing long URLs not far past this.
const URL_MAX = 8 * 1024

export function reportBody({ environment, log }: BugReportParts): string {
  const lines = [environment, '', '**What happened?**', '<!-- describe what you were doing -->']
  if (log) {
    lines.push(
      '',
      '<details><summary>Recent errors (local log, no note content)</summary>',
      '',
      '```text',
      log,
      '```',
      '</details>'
    )
  }
  return lines.join('\n')
}

// The newest log lines are the ones that explain the bug, so the oldest go first.
export function issueUrl(parts: BugReportParts): string {
  let lines = parts.log ? parts.log.split('\n') : []
  for (;;) {
    const params = new URLSearchParams({
      title: ISSUE_TITLE,
      body: reportBody({ ...parts, log: lines.join('\n') })
    })
    const url = `${ISSUE_URL}?${params}`
    if (url.length <= URL_MAX || lines.length === 0) return url
    lines = lines.slice(1)
  }
}

// A report is still worth sending without the log, so a failed read isn't an error here.
export async function loadReportParts(): Promise<BugReportParts> {
  const result = await notvex.log.buildReport()
  return result.success ? result.data : { environment: '', log: '' }
}

export async function openBugReport(): Promise<void> {
  await notvex.shell.openExternal(issueUrl(await loadReportParts()))
}
