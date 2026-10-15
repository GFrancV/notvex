// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  close: vi.fn(),
  isDev: vi.fn(),
  prefsGet: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    app: { isDev: ipc.isDev },
    prefs: { get: ipc.prefsGet },
    updater: { getCurrentVersion: async () => ({ success: true, data: '1.0.0' }) },
    vault: { close: ipc.close }
  }
}))

// The dialog itself is covered by settings-dialog.test.ts; here only the wiring matters, and
// mounting the real dialog on top of the whole sidebar is slow enough to time out.
vi.mock('@/components/settings-dialog', () => ({
  SettingsDialog: ({ open }: { open: boolean }) =>
    open ? createElement('h2', null, 'Settings') : null
}))

const { Sidebar } = await import('@/components/sidebar')
const { SidebarProvider } = await import('@/components/ui/sidebar')
const { useVaultStore } = await import('@/store/vault.store')

beforeAll(() => {
  // SidebarProvider's mobile detection needs matchMedia, which jsdom lacks.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as typeof window.matchMedia
})

beforeEach(() => {
  // From the second Radix menu opened in a file, jsdom reads the menu's own auto-focus as a focus
  // outside it and closes it at once (see note-list-sort.test.ts). Browsers don't.
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
  ipc.close.mockResolvedValue({ success: true, data: null })
  ipc.isDev.mockResolvedValue({ success: true, data: false })
  ipc.prefsGet.mockResolvedValue({ success: false, error: 'not needed' })
  useVaultStore.setState({
    status: 'unlocked',
    currentVaultPath: 'C:/vaults/work.nvx',
    notes: [],
    tags: [],
    tagCounts: {},
    loadTags: vi.fn(async () => undefined),
    loadTagCounts: vi.fn(async () => undefined)
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

async function renderSidebar(): Promise<void> {
  await act(async () => {
    render(createElement(SidebarProvider, null, createElement(Sidebar)))
  })
}

describe('Sidebar entry points', () => {
  it('opens Settings straight from the gear button', async () => {
    await renderSidebar()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
  })

  it('locks the vault from the vault menu', async () => {
    await renderSidebar()

    fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Lock vault' }))

    await waitFor(() => expect(useVaultStore.getState().status).toBe('locked'))
    expect(ipc.close).toHaveBeenCalledOnce()
  })
})
