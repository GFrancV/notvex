// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A plain <a href> starts a main-frame navigation, which will-navigate blocks, so links must
// go through shell.openExternal.

const ipc = vi.hoisted(() => ({
  openExternal: vi.fn().mockResolvedValue({ success: true, data: null }),
  buildReport: vi
    .fn()
    .mockResolvedValue({ success: true, data: { environment: 'env', log: 'log line' } }),
  openFolder: vi.fn().mockResolvedValue({ success: true, data: null }),
  clear: vi.fn().mockResolvedValue({ success: true, data: null })
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    updater: { getCurrentVersion: vi.fn().mockResolvedValue({ success: true, data: '1.0.0' }) },
    shell: { openExternal: ipc.openExternal },
    log: { buildReport: ipc.buildReport, openFolder: ipc.openFolder, clear: ipc.clear }
  }
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { AppVersionDialog } = await import('@/components/dialogs/AppVersionDialog')
const { ISSUE_URL } = await import('@/lib/bug-report')
const { toast } = await import('sonner')

const renderDialog = (): void => {
  render(createElement(AppVersionDialog, { open: true, onClose: () => {} }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AppVersionDialog links (issue #60)', () => {
  it('"Docs" opens the repo in the system browser instead of navigating', () => {
    const url = 'https://github.com/GFrancV/notvex'
    renderDialog()
    const link = screen.getByText('Docs')

    fireEvent.click(link)

    // Nothing that could start a main-frame navigation (the dialog renders in a
    // portal, so look at the whole document).
    expect(link.closest('a[href]')).toBeNull()
    expect(document.querySelector(`a[href="${url}"]`)).toBeNull()
    expect(ipc.openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })
})

describe('AppVersionDialog troubleshooting', () => {
  it('opens a prefilled bug report in the system browser', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /report bug/i }))

    await waitFor(() => expect(ipc.openExternal).toHaveBeenCalledTimes(1))
    expect(ipc.openExternal.mock.calls[0][0]).toMatch(new RegExp(`^${ISSUE_URL}\\?`))
  })

  it('opens the logs folder', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /open logs folder/i }))

    expect(ipc.openFolder).toHaveBeenCalledTimes(1)
  })

  it('asks for a second click before clearing the logs', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /clear logs/i }))
    expect(ipc.clear).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /confirm clear/i }))

    await waitFor(() => expect(ipc.clear).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Logs cleared')
  })

  it('tells the user when clearing fails', async () => {
    ipc.clear.mockResolvedValueOnce({ success: false, error: 'EBUSY' })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /clear logs/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm clear/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't clear the logs"))
  })
})
