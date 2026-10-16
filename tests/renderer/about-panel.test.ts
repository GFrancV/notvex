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

const { AboutPanel } = await import('@/components/settings/AboutPanel')

describe('AboutPanel links', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('"Open docs" opens the repo in the system browser instead of navigating', () => {
    const url = 'https://github.com/GFrancV/notvex'
    render(createElement(AboutPanel))
    const link = screen.getByRole('button', { name: 'Open docs' })

    fireEvent.click(link)

    // Nothing in the document that could start a main-frame navigation.
    expect(link.closest('a[href]')).toBeNull()
    expect(document.querySelector(`a[href="${url}"]`)).toBeNull()
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })

  it('"Report a bug…" opens a prefilled bug report in the system browser', async () => {
    render(createElement(AboutPanel))
    const link = screen.getByRole('button', { name: 'Report a bug…' })

    fireEvent.click(link)

    expect(link.closest('a[href]')).toBeNull()
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1))
    expect(openExternal.mock.calls[0][0]).toMatch(
      /^https:\/\/github\.com\/GFrancV\/notvex\/issues\/new\?.*body=/
    )
  })
})
