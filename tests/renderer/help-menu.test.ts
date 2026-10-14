// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The window menu bar is hidden on Windows and Linux, so this is the in-app Help menu.

const ipc = vi.hoisted(() => ({
  openExternal: vi.fn(),
  buildReport: vi.fn(),
  openFolder: vi.fn(),
  clear: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    shell: { openExternal: ipc.openExternal },
    log: { buildReport: ipc.buildReport, openFolder: ipc.openFolder, clear: ipc.clear }
  }
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { HelpMenu } = await import('@/components/HelpMenu')
const { ISSUE_URL, reportBody } = await import('@/lib/bug-report')
const { toast } = await import('sonner')

const PARTS = { environment: 'env', log: 'log line' }
const onOpenAbout = vi.fn()

async function openMenu(): Promise<void> {
  render(createElement(HelpMenu, { onOpenAbout }))
  fireEvent.keyDown(screen.getByRole('button', { name: 'Help' }), { key: 'Enter' })
  await screen.findByRole('menu')
}

const item = (name: RegExp): HTMLElement => screen.getByRole('menuitem', { name })

beforeEach(() => {
  // From the second Radix menu opened in a file, jsdom reads the menu's own auto-focus as a focus
  // outside it and closes it at once (see note-list-sort.test.ts). Browsers don't.
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
  ipc.openExternal.mockResolvedValue({ success: true, data: null })
  ipc.buildReport.mockResolvedValue({ success: true, data: PARTS })
  ipc.openFolder.mockResolvedValue({ success: true, data: null })
  ipc.clear.mockResolvedValue({ success: true, data: null })
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('HelpMenu', () => {
  it('lists help, diagnostics and About, with About last', async () => {
    await openMenu()

    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim())
    expect(labels).toEqual([
      'Documentation',
      'Report a bug…',
      'Copy debug info',
      'Open logs folder',
      'Clear logs…',
      'About Notvex'
    ])
  })

  it('opens the documentation in the system browser', async () => {
    await openMenu()
    fireEvent.click(item(/documentation/i))
    expect(ipc.openExternal).toHaveBeenCalledWith('https://github.com/GFrancV/notvex')
  })

  it('opens a prefilled bug report', async () => {
    await openMenu()
    fireEvent.click(item(/report a bug/i))

    await waitFor(() => expect(ipc.openExternal).toHaveBeenCalledTimes(1))
    expect(ipc.openExternal.mock.calls[0][0]).toMatch(new RegExp(`^${ISSUE_URL}\\?`))
  })

  it('copies the debug info to the clipboard', async () => {
    await openMenu()
    fireEvent.click(item(/copy debug info/i))

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(reportBody(PARTS))
    )
  })

  it('opens the logs folder', async () => {
    await openMenu()
    fireEvent.click(item(/open logs folder/i))
    expect(ipc.openFolder).toHaveBeenCalledTimes(1)
  })

  it('says so when the logs folder cannot be opened', async () => {
    ipc.openFolder.mockResolvedValue({ success: false, error: 'Failed to open path' })
    await openMenu()
    fireEvent.click(item(/open logs folder/i))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't open the logs folder"))
  })

  it('says so when the browser cannot be opened for a bug report', async () => {
    ipc.openExternal.mockResolvedValue({ success: false, error: 'no browser' })
    await openMenu()
    fireEvent.click(item(/report a bug/i))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't open the browser"))
  })

  it('opens the About dialog', async () => {
    await openMenu()
    fireEvent.click(item(/about notvex/i))
    expect(onOpenAbout).toHaveBeenCalledTimes(1)
  })

  describe('Clear logs', () => {
    async function openClearDialog(): Promise<void> {
      await openMenu()
      fireEvent.click(item(/clear logs/i))
      await screen.findByRole('dialog')
    }

    it('asks for confirmation before clearing anything', async () => {
      await openClearDialog()

      expect(ipc.clear).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog').textContent).toMatch(/can't be undone/i)
    })

    it('leaves the logs alone when cancelled', async () => {
      await openClearDialog()

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(ipc.clear).not.toHaveBeenCalled()
    })

    it('clears the logs once confirmed', async () => {
      await openClearDialog()

      fireEvent.click(screen.getByRole('button', { name: /^clear logs$/i }))

      await waitFor(() => expect(ipc.clear).toHaveBeenCalledTimes(1))
      expect(toast.success).toHaveBeenCalledWith('Logs cleared')
    })

    it('can still be closed when the clear call itself rejects', async () => {
      ipc.clear.mockRejectedValue(new Error('IPC gone'))
      await openClearDialog()

      fireEvent.click(screen.getByRole('button', { name: /^clear logs$/i }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't clear the logs"))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('says so when clearing fails', async () => {
      ipc.clear.mockResolvedValue({ success: false, error: 'EBUSY' })
      await openClearDialog()

      fireEvent.click(screen.getByRole('button', { name: /^clear logs$/i }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't clear the logs"))
    })
  })
})
