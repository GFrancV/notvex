// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteCounts, NoteListItem } from '@shared/types'

const ipc = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  duplicate: vi.fn(),
  counts: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    app: { isDev: async () => ({ success: true, data: false }) },
    prefs: { get: async () => ({ success: false, error: 'not needed' }) },
    updater: { getCurrentVersion: async () => ({ success: true, data: '1.0.0' }) },
    vault: { close: async () => ({ success: true, data: null }) },
    notes: { list: ipc.list, create: ipc.create, duplicate: ipc.duplicate, counts: ipc.counts }
  }
}))

// Only the badges are under test; the real dialog is slow to mount on top of the sidebar.
vi.mock('@/components/settings-dialog', () => ({ SettingsDialog: () => null }))

const { Sidebar } = await import('@/components/sidebar')
const { SidebarProvider } = await import('@/components/ui/sidebar')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

const COUNTS: NoteCounts = { live: 3, pinned: 1, trashed: 2 }
const ZERO: NoteCounts = { live: 0, pinned: 0, trashed: 0 }

function item(patch: Partial<NoteListItem>): NoteListItem {
  return {
    id: 'n1',
    title: 'Plan',
    isPinned: false,
    isTrashed: false,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags: [],
    ...patch
  }
}

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
  ipc.counts.mockResolvedValue({ success: true, data: COUNTS })
  useUiStore.getState().resetFilters()
  useVaultStore.setState({
    status: 'unlocked',
    currentVaultPath: 'C:/vaults/work.nvx',
    notes: [],
    tags: [],
    tagCounts: {},
    noteCounts: ZERO
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderSidebar(): Promise<void> {
  await act(async () => {
    render(createElement(SidebarProvider, null, createElement(Sidebar)), {
      wrapper: TooltipProvider
    })
  })
}

function badge(label: string): string | undefined {
  // The badge is the button's sibling inside the same menu item.
  return screen.getByRole('button', { name: label }).closest('li')?.textContent?.replace(label, '')
}

describe('sidebar badges', () => {
  it.each([
    ['All notes', {}],
    ['Pinned', { showPinned: true }],
    ['a tag filter', { activeTags: ['tag1'] }],
    ['search', { searchQuery: 'plan' }],
    ['Trash', { showTrash: true }]
  ])('show the vault-wide counts in %s, whatever the list holds', async (_view, ui) => {
    useUiStore.setState(ui)
    useVaultStore.setState({
      notes: [item({ id: 't1', isTrashed: true })],
      noteCounts: COUNTS,
      loadTags: vi.fn(async () => undefined),
      loadTagCounts: vi.fn(async () => undefined)
    })
    await renderSidebar()

    expect(badge('All notes')).toBe('3')
    expect(badge('Pinned')).toBe('1')
    expect(badge('Trash')).toBe('2')
  })
})

describe('noteCounts', () => {
  it('refreshes whenever the list reloads', async () => {
    ipc.list.mockResolvedValue({ success: true, data: [] })

    await useVaultStore.getState().loadNotes({ trashed: true })

    await waitFor(() => expect(useVaultStore.getState().noteCounts).toEqual(COUNTS))
  })

  it.each([
    ['createNote', () => useVaultStore.getState().createNote()],
    ['duplicateNote', () => useVaultStore.getState().duplicateNote('n1')]
  ])('refreshes after %s, which does not reload the list', async (_name, run) => {
    ipc.create.mockResolvedValue({ success: true, data: item({ id: 'n2' }) })
    ipc.duplicate.mockResolvedValue({ success: true, data: item({ id: 'n3' }) })

    await run()

    await waitFor(() => expect(useVaultStore.getState().noteCounts).toEqual(COUNTS))
    expect(ipc.list).not.toHaveBeenCalled()
  })

  it('is reset when the session ends', () => {
    useVaultStore.setState({ noteCounts: COUNTS })

    useVaultStore.getState().clearSession()

    expect(useVaultStore.getState().noteCounts).toEqual(ZERO)
  })

  it('drops a reply that lands after the session ended', async () => {
    let reply: (v: unknown) => void = () => {}
    ipc.counts.mockReturnValueOnce(new Promise((resolve) => (reply = resolve)))

    const pending = useVaultStore.getState().loadNoteCounts()
    useVaultStore.getState().clearSession()
    reply({ success: true, data: COUNTS })
    await pending

    expect(useVaultStore.getState().noteCounts).toEqual(ZERO)
  })
})
