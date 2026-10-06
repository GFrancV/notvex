// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A plain <a href> starts a main-frame navigation, which will-navigate blocks,
// so the links did nothing. They must go through shell.openExternal like every
// other external link in the renderer (#60).

const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, data: null }))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    updater: { getCurrentVersion: vi.fn().mockResolvedValue({ success: true, data: '1.0.0' }) },
    shell: { openExternal }
  }
}))

const { AppVersionDialog } = await import('@/components/dialogs/AppVersionDialog')

describe('AppVersionDialog links (issue #60)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it.each([
    ['Docs', 'https://github.com/GFrancV/notvex'],
    ['Report Issue', 'https://github.com/GFrancV/notvex/issues/new']
  ])('"%s" opens %s in the system browser instead of navigating', (label, url) => {
    render(createElement(AppVersionDialog, { open: true, onClose: () => {} }))
    const link = screen.getByText(label)

    fireEvent.click(link)

    // Nothing that could start a main-frame navigation (the dialog renders in a
    // portal, so look at the whole document).
    expect(link.closest('a[href]')).toBeNull()
    expect(document.querySelector(`a[href="${url}"]`)).toBeNull()
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })
})
