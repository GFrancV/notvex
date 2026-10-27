// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The window menu bar is hidden on Windows and Linux, so this is the in-app Help menu.

const ipc = vi.hoisted(() => ({
  openExternal: vi.fn(),
  buildReport: vi.fn(),
  clipboardWrite: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    shell: { openExternal: ipc.openExternal },
    log: { buildReport: ipc.buildReport },
    clipboard: { write: ipc.clipboardWrite }
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
  ipc.clipboardWrite.mockResolvedValue({ success: true, data: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('HelpMenu', () => {
  it('lists help and About, with About last; the log actions live in Settings', async () => {
    await openMenu()

    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim())
    expect(labels).toEqual(['Documentation', 'Report a bug', 'Copy debug info', 'About Notvex'])
  })

  it('says which items open the browser', async () => {
    await openMenu()

    expect(item(/^Documentation \(opens in your browser\)$/)).toBeTruthy()
    expect(item(/^Report a bug \(opens in your browser\)$/)).toBeTruthy()
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
      expect(ipc.clipboardWrite).toHaveBeenCalledWith(reportBody(PARTS), {
        secret: false,
        fromUnlockedView: false
      })
    )
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
})
