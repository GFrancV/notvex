// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A plain <a href> starts a main-frame navigation, which will-navigate blocks, so links must
// go through shell.openExternal.

const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, data: null }))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    updater: { getCurrentVersion: vi.fn().mockResolvedValue({ success: true, data: '1.0.0' }) },
    shell: { openExternal },
    log: {
      buildReport: vi.fn().mockResolvedValue({ success: true, data: { environment: 'e', log: '' } })
    }
  }
}))

const { AppVersionDialog } = await import('@/components/dialogs/AppVersionDialog')

describe('AppVersionDialog links (issue #60)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('"Docs" opens the repo in the system browser instead of navigating', () => {
    const url = 'https://github.com/GFrancV/notvex'
    render(createElement(AppVersionDialog, { open: true, onClose: () => {} }))
    const link = screen.getByText('Docs')

    fireEvent.click(link)

    // Nothing that could start a main-frame navigation (the dialog renders in a
    // portal, so look at the whole document).
    expect(link.closest('a[href]')).toBeNull()
    expect(document.querySelector(`a[href="${url}"]`)).toBeNull()
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })

  it('"Report Issue" opens a prefilled bug report in the system browser', async () => {
    render(createElement(AppVersionDialog, { open: true, onClose: () => {} }))
    const link = screen.getByText('Report Issue')

    fireEvent.click(link)

    expect(link.closest('a[href]')).toBeNull()
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1))
    expect(openExternal.mock.calls[0][0]).toMatch(
      /^https:\/\/github\.com\/GFrancV\/notvex\/issues\/new\?.*body=/
    )
  })
})
