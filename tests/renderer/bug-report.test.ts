// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The report is opened in the user's browser, who reviews it before submitting: nothing is sent
// from the app. Browsers and GitHub reject very long URLs, hence the 8 KB fit.

const ipc = vi.hoisted(() => ({ buildReport: vi.fn(), openExternal: vi.fn() }))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    log: { buildReport: ipc.buildReport },
    shell: { openExternal: ipc.openExternal }
  }
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { ISSUE_URL, issueUrl, reportBody } = await import('@/lib/bug-report')
const { BugReportActions } = await import('@/components/BugReportActions')

const ENVIRONMENT = '**Version:** 1.4.0 · **Electron:** 38.0.0 · **OS:** win32 10.0 x64'
const LOG = '2026-01-01T00:00:00.000Z [renderer] v1.4.0 TypeError\n    at f (out/x.js:1:1)'

const bodyOf = (url: string): string => new URL(url).searchParams.get('body') ?? ''

describe('reportBody', () => {
  it('includes the environment, a prompt and the log', () => {
    const body = reportBody({ environment: ENVIRONMENT, log: LOG })

    expect(body).toContain(ENVIRONMENT)
    expect(body).toContain('**What happened?**')
    expect(body).toContain(LOG)
  })

  it('leaves out the log section when there is no log', () => {
    expect(reportBody({ environment: ENVIRONMENT, log: '' })).not.toContain('<details>')
  })
})

describe('issueUrl', () => {
  it('opens a new issue with the full report when it fits', () => {
    const url = issueUrl({ environment: ENVIRONMENT, log: LOG })

    expect(url.startsWith(`${ISSUE_URL}?`)).toBe(true)
    expect(bodyOf(url)).toBe(reportBody({ environment: ENVIRONMENT, log: LOG }))
  })

  it('stays under 8 KB by dropping the oldest log lines first', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i} ${'x'.repeat(40)}`)

    const url = issueUrl({ environment: ENVIRONMENT, log: lines.join('\n') })

    expect(url.length).toBeLessThanOrEqual(8 * 1024)
    expect(bodyOf(url)).toContain('line-299 ')
    expect(bodyOf(url)).not.toContain('line-0 ')
    expect(bodyOf(url)).toContain(ENVIRONMENT)
  })
})

describe('BugReportActions', () => {
  beforeEach(() => {
    ipc.buildReport
      .mockReset()
      .mockResolvedValue({ success: true, data: { environment: ENVIRONMENT, log: LOG } })
    ipc.openExternal.mockReset().mockResolvedValue({ success: true, data: null })
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
  })

  afterEach(cleanup)

  it('opens the prefilled issue in the browser', async () => {
    render(createElement(BugReportActions))

    fireEvent.click(screen.getByRole('button', { name: /report bug/i }))

    await waitFor(() =>
      expect(ipc.openExternal).toHaveBeenCalledWith(
        issueUrl({ environment: ENVIRONMENT, log: LOG })
      )
    )
  })

  it('copies the same report text to the clipboard', async () => {
    render(createElement(BugReportActions))

    fireEvent.click(screen.getByRole('button', { name: /copy debug info/i }))

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        reportBody({ environment: ENVIRONMENT, log: LOG })
      )
    )
    // The ErrorBoundary fallback has no Toaster, so the button itself confirms.
    expect(await screen.findByRole('button', { name: /copied/i })).toBeTruthy()
  })

  it('still opens a report when the log cannot be read', async () => {
    ipc.buildReport.mockResolvedValue({ success: false, error: 'EACCES' })
    render(createElement(BugReportActions))

    fireEvent.click(screen.getByRole('button', { name: /report bug/i }))

    await waitFor(() => expect(ipc.openExternal).toHaveBeenCalledTimes(1))
    expect(ipc.openExternal.mock.calls[0][0]).toMatch(new RegExp(`^${ISSUE_URL}\\?`))
  })
})
