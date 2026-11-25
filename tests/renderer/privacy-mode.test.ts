// @vitest-environment jsdom
import { type ComponentProps, createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem, Prefs, Tag } from '@shared/types'

const ipc = vi.hoisted(() => ({ prefsGet: vi.fn(), prefsSet: vi.fn(), list: vi.fn() }))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    prefs: { get: ipc.prefsGet, set: ipc.prefsSet },
    notes: {
      list: ipc.list,
      counts: vi.fn(async () => ({ success: true, data: { live: 2, pinned: 0, trashed: 1 } }))
    }
  }
}))
vi.mock('@/lib/bug-report', () => ({
  openBugReport: vi.fn(),
  loadDebugInfo: vi.fn(),
  openLogsFolder: vi.fn()
}))
vi.mock('@/lib/reload-window', () => ({ requestReload: vi.fn() }))

const { CommandPalette } = await import('@/components/command-palette')
const { NoteList } = await import('@/components/note-list')
const { PrivacyModeToggle } = await import('@/components/PrivacyModeToggle')
const { TagChip } = await import('@/components/tags/TagChip')
const { TagFilter } = await import('@/components/tags/TagFilter')
const { TagItem } = await import('@/components/tags/TagItem')
const { TagSelector } = await import('@/components/tags/TagSelector')
const { SidebarMenu, SidebarProvider } = await import('@/components/ui/sidebar')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { usePrefsStore } = await import('@/store/prefs.store')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

const MASK = '••••••••'

function tag(id: string, name: string, color: string): Tag {
  return { id, name, color, createdAt: 0 }
}

const crypto = tag('tag-1', 'crypto', '#f59e0b')
const work = tag('tag-2', 'work', '#8b5cf6')
const personal = tag('tag-3', 'personal', '#3b82f6')

function note(id: string, title: string, isTrashed: boolean, tags: Tag[]): NoteListItem {
  return {
    id,
    title,
    isPinned: false,
    isTrashed,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: isTrashed ? 0 : null,
    tags
  }
}

const live = [
  note('a', 'Seed phrases', false, [crypto, work]),
  note('b', 'Grocery list', false, [personal])
]
const trashed = [note('t1', 'Old passwords', true, [crypto])]
const SECRETS = ['Seed phrases', 'Grocery list', 'Old passwords', 'crypto', 'work', 'personal']

const SAVED: Prefs = {
  recentVaults: [],
  unconfirmedRecoveryVaults: [],
  autoLockMinutes: 15,
  allowScreenCapture: false,
  lockOnMinimize: false,
  clipboardClearSeconds: 60,
  clearClipboardOnLock: true,
  noteSort: { field: 'updatedAt', direction: 'desc' },
  checkUpdatesOnStartup: true,
  privacyMode: true,
  updateSnooze: null
}

// Radix positions tooltips with ResizeObserver, which jsdom doesn't implement.
globalThis.ResizeObserver ??= class {
  observe = (): void => {}
  unobserve = (): void => {}
  disconnect = (): void => {}
}

// cmdk scrolls the highlighted item into view; jsdom doesn't implement it.
Element.prototype.scrollIntoView ??= (): void => {}

// SidebarProvider reads the viewport width through useIsMobile.
window.matchMedia ??= ((): MediaQueryList =>
  ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  }) as unknown as MediaQueryList) as typeof window.matchMedia

const settle = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 50)))

async function openTooltip(trigger: HTMLElement): Promise<void> {
  fireEvent.pointerMove(trigger)
  await settle()
}

const withTooltips = (ui: ReturnType<typeof createElement>): ReturnType<typeof createElement> =>
  createElement(TooltipProvider, { delayDuration: 0 } as ComponentProps<typeof TooltipProvider>, ui)

function expectNoSecretInPage(): void {
  const page = document.body.innerHTML
  for (const secret of SECRETS) expect(page).not.toContain(secret)
}

beforeEach(() => {
  ipc.list.mockImplementation(async (f: { trashed?: boolean } = {}) => ({
    success: true,
    data: f.trashed ? trashed : live
  }))
  useUiStore.getState().resetFilters()
  useVaultStore.setState({ notes: [], activeNoteId: null, noteTagsMap: {} })
  usePrefsStore.setState({ ready: false, privacyMode: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('privacy mode preference', () => {
  it('loads privacyMode from prefs on start', async () => {
    ipc.prefsGet.mockResolvedValue({ success: true, data: SAVED })

    await usePrefsStore.getState().load()

    expect(usePrefsStore.getState().privacyMode).toBe(true)
  })
})

describe('privacy mode in the note list', () => {
  async function renderList(): Promise<void> {
    await act(async () => {
      render(
        createElement(
          TooltipProvider,
          { delayDuration: 0 } as ComponentProps<typeof TooltipProvider>,
          createElement(NoteList)
        )
      )
    })
    await settle()
  }

  it.each([
    ['notes', false, 2],
    ['trash', true, 1]
  ])(
    'note list shows the mask for every title and tag, and the real text isn’t in the DOM (%s)',
    async (_view, showTrash, rows) => {
      usePrefsStore.setState({ privacyMode: true })
      useUiStore.setState({ showTrash })
      await renderList()

      // Each row: its title and its first tag.
      expect(screen.getAllByText(MASK)).toHaveLength(rows * 2)
      expectNoSecretInPage()

      for (const trigger of screen.getAllByText(MASK).filter((e) => e.closest('[data-slot]'))) {
        await openTooltip(trigger)
      }
      if (!showTrash) {
        await openTooltip(screen.getByText('+1'))
        expect(screen.getByRole('tooltip').textContent).toContain('Hidden')
      }
      expectNoSecretInPage()
    }
  )

  it('sidebar search matches real titles, shows masked results and keeps the typed text', async () => {
    usePrefsStore.setState({ privacyMode: true })
    useVaultStore.setState({ tags: [crypto], noteTagsMap: { a: [crypto.id], b: [crypto.id] } })
    useUiStore.setState({ activeTags: [crypto.id] })
    await renderList()

    await act(async () => useUiStore.getState().setSearchQuery('grocery'))
    await settle()

    // One row left: only the real title "Grocery list" contains the query.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
    expect(screen.getByText('title contains "grocery"')).toBeTruthy()
    expectNoSecretInPage()
  })
})

describe('privacy mode in tags', () => {
  it('sidebar tags, tag chips and tag filter show the mask and keep their colors', async () => {
    usePrefsStore.setState({ privacyMode: true })
    useVaultStore.setState({ tags: [crypto] })
    useUiStore.setState({ activeTags: [crypto.id] })
    const noop = (): void => {}

    await act(async () => {
      render(
        withTooltips(
          createElement(
            SidebarProvider,
            null,
            createElement(
              SidebarMenu,
              null,
              createElement(TagItem, {
                tag: crypto,
                count: 1,
                active: true,
                onClick: noop,
                onToggle: noop,
                onEdit: noop,
                onDelete: noop
              })
            ),
            createElement(TagChip, { tag: work, onRemove: noop }),
            createElement(TagFilter, { count: 1 })
          )
        )
      )
    })

    // The sidebar item, the chip, and the chip inside the tag filter.
    expect(screen.getAllByText(MASK)).toHaveLength(3)
    expectNoSecretInPage()

    for (const trigger of screen.getAllByText(MASK)) await openTooltip(trigger)
    await openTooltip(screen.getAllByRole('button', { name: /^Remove/ })[0])
    expect(screen.getAllByRole('tooltip').length).toBeGreaterThan(0)
    expectNoSecretInPage()

    const dots = [...document.querySelectorAll<HTMLElement>('.rounded-full')].map(
      (d) => d.style.backgroundColor
    )
    expect(dots).toContain('rgb(245, 158, 11)')
    expect(dots).toContain('rgb(139, 92, 246)')
  })

  it('tag selector shows the mask and still filters by the real tag name', async () => {
    usePrefsStore.setState({ privacyMode: true })
    const addTagToNote = vi.fn(async (): Promise<void> => undefined)
    useVaultStore.setState({ tags: [crypto, work, personal], noteTagsMap: {}, addTagToNote })

    render(
      createElement(
        TagSelector,
        { noteId: 'a', open: true, onOpenChange: vi.fn() },
        createElement('button', null, 'Add tag')
      )
    )
    const input = screen.getByRole('combobox', { name: 'Search tags' })
    const options = (): string[] => screen.queryAllByRole('option').map((o) => o.textContent ?? '')

    expect(options()).toEqual([`${MASK}Hidden`, `${MASK}Hidden`, `${MASK}Hidden`])
    expectNoSecretInPage()

    // The full name: a partial one also offers "Create …", which cmdk ranks first.
    fireEvent.change(input, { target: { value: 'personal' } })
    await settle()
    expect(options()).toEqual([`${MASK}Hidden`])
    // The search box shows what was typed; the results must not.
    expect(screen.getByRole('listbox').innerHTML).not.toContain('personal')

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(addTagToNote).toHaveBeenCalledExactlyOnceWith('a', personal.id)
  })
})

describe('turning privacy mode on and off', () => {
  it('eye button toggles the mode and reports it with aria-pressed', async () => {
    ipc.prefsSet.mockResolvedValue({ success: true, data: null })
    render(withTooltips(createElement(PrivacyModeToggle)))
    const button = screen.getByRole('button', { name: 'Privacy mode' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    await openTooltip(button)
    expect(screen.getByRole('tooltip').textContent).toBe('Privacy mode Ctrl Shift H')

    await act(async () => fireEvent.click(button))
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(usePrefsStore.getState().privacyMode).toBe(true)
    expect(ipc.prefsSet).toHaveBeenLastCalledWith('privacyMode', true)

    await act(async () => fireEvent.click(button))
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(ipc.prefsSet).toHaveBeenLastCalledWith('privacyMode', false)
  })
})

describe('privacy mode in the command palette', () => {
  it('command palette masks note items, matches real titles and keeps the typed text', async () => {
    usePrefsStore.setState({ privacyMode: true })
    useVaultStore.setState({ notes: live, activeNoteId: null, noteTagsMap: {} })
    useUiStore.setState({ commandPaletteOpen: true })
    render(createElement(CommandPalette))
    const input = screen.getByRole('combobox')
    const notes = (): string[] =>
      screen
        .queryAllByRole('option')
        .map((o) => o.textContent ?? '')
        .filter((t) => t.includes(MASK))

    expect(notes()).toEqual([`${MASK}Hidden`, `${MASK}Hidden`])
    expectNoSecretInPage()

    fireEvent.change(input, { target: { value: 'grocery' } })
    await settle()
    expect(notes()).toEqual([`${MASK}Hidden`])
    expect(screen.getByText('Create note "grocery"')).toBeTruthy()
    // The search box shows what was typed; the results must not.
    expect(screen.getByRole('listbox').innerHTML).not.toContain('Grocery list')

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(useVaultStore.getState().activeNoteId).toBe('b')
  })
})
