// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem } from '@shared/types'

const note = (id: string, title: string, isTrashed = false): NoteListItem => ({
  id,
  title,
  isPinned: false,
  isTrashed,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null,
  tags: []
})

vi.mock('@/lib/ipc', () => ({ notvex: {} }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { useCreateNote } = await import('@/hooks/use-create-note')
const { CommandPalette } = await import('@/components/command-palette')
const { toast } = await import('sonner')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

const createNote = vi.fn((input?: { title: string }) =>
  Promise.resolve(note('n-new', input?.title ?? 'Untitled'))
)

beforeAll(() => {
  // cmdk measures and scrolls its list; jsdom implements neither.
  globalThis.ResizeObserver ??= class {
    observe = (): void => {}
    unobserve = (): void => {}
    disconnect = (): void => {}
  }
  Element.prototype.scrollIntoView ??= (): void => {}
})

beforeEach(() => {
  useVaultStore.setState({ createNote, activeNoteId: null, notes: [], noteTagsMap: {} })
  useUiStore.setState({ searchQuery: '', commandPaletteOpen: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const NATO = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india']

function openPalette(notes: NoteListItem[]): void {
  useVaultStore.setState({ notes })
  useUiStore.setState({ commandPaletteOpen: true })
  render(createElement(CommandPalette))
}

function type(query: string): void {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
}

const option = (name: string): HTMLElement | null => screen.queryByRole('option', { name })

describe('command palette notes', () => {
  const notes = [...NATO.map((t) => note(`n-${t}`, t)), note('n-kilo', 'kilo', true)]

  it('lists only the 8 most recent non-trashed notes while the query is empty', () => {
    openPalette(notes)
    for (const t of NATO.slice(0, 8)) expect(option(t)).not.toBeNull()
    expect(option('india')).toBeNull()
    expect(option('kilo')).toBeNull()
  })

  it('finds a note beyond the 8 most recent', () => {
    openPalette(notes)
    type('india')
    expect(option('india')).not.toBeNull()
  })

  it('never shows trashed notes', () => {
    openPalette(notes)
    type('kilo')
    expect(option('kilo')).toBeNull()
  })

  it('starts with an empty query after reopening', () => {
    openPalette(notes)
    type('india')
    act(() => useUiStore.setState({ commandPaletteOpen: false }))
    act(() => useUiStore.setState({ commandPaletteOpen: true }))
    expect(screen.getByRole<HTMLInputElement>('combobox').value).toBe('')
    expect(option('india')).toBeNull()
  })

  it('keeps notes that share a title apart', () => {
    openPalette([1, 2, 3, 4, 5, 6].map((i) => note(`n-${i}`, 'Untitled')))
    type('Untitled')
    const options = screen.getAllByRole('option', { name: 'Untitled' })
    expect(new Set(options.map((el) => el.dataset.value)).size).toBe(6)
    expect(options.filter((el) => el.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  })
})

describe('useCreateNote', () => {
  it('uses the given title over the sidebar search query', async () => {
    useUiStore.setState({ searchQuery: 'sidebar text' })
    const { result } = renderHook(() => useCreateNote())
    await act(() => result.current('palette text'))
    expect(createNote).toHaveBeenCalledWith({ title: 'palette text', content: '' })
    expect(useVaultStore.getState().activeNoteId).toBe('n-new')
  })

  it('falls back to the sidebar search query without a title', async () => {
    useUiStore.setState({ searchQuery: '  sidebar text ' })
    const { result } = renderHook(() => useCreateNote())
    await act(() => result.current())
    expect(createNote).toHaveBeenCalledWith({ title: 'sidebar text', content: '' })
    expect(useUiStore.getState().searchQuery).toBe('')
  })

  it('creates an untitled note when there is no title and no query', async () => {
    const { result } = renderHook(() => useCreateNote())
    await act(() => result.current())
    expect(createNote).toHaveBeenCalledWith(undefined)
  })
})

describe('command palette create note from query', () => {
  const createOption = (q: string): HTMLElement | null => option(`Create note "${q}"`)

  it('is hidden while the query is empty', () => {
    openPalette([note('n-1', 'alpha')])
    expect(screen.queryByRole('option', { name: /^Create note/ })).toBeNull()
  })

  it('shows when nothing else matches, without the empty message', () => {
    openPalette([note('n-1', 'alpha')])
    type('qqq')
    expect(createOption('qqq')).not.toBeNull()
    expect(screen.queryByText('No results found.')).toBeNull()
  })

  it('comes after matching notes so Enter still opens the match', () => {
    openPalette([note('n-1', 'alpha')])
    type('alpha')
    const options = screen.getAllByRole('option')
    expect(options[0].textContent).toBe('alpha')
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(options.at(-1)).toBe(createOption('alpha'))
  })

  it('creates and opens a note titled with the trimmed query', async () => {
    openPalette([note('n-1', 'alpha')])
    type('  my idea ')
    await act(async () => fireEvent.click(createOption('my idea')!))
    expect(createNote).toHaveBeenCalledWith({ title: 'my idea', content: '' })
    expect(useVaultStore.getState().activeNoteId).toBe('n-new')
    expect(useUiStore.getState().commandPaletteOpen).toBe(false)
  })

  it.each([
    ['Create note "qqq"', 'qqq'],
    [/^New Note/, 'new note']
  ])('toasts when creating from %s fails', async (name, query) => {
    createNote.mockRejectedValueOnce(new Error('db locked'))
    openPalette([])
    type(query)
    await act(async () => fireEvent.click(screen.getByRole('option', { name })))
    expect(toast.error).toHaveBeenCalledWith('Failed to create note')
  })
})

describe('command palette synonyms', () => {
  it.each([
    ['create note', /^New Note/],
    ['add note', /^New Note/],
    ['preview', /^Toggle Reading View/],
    ['bin', /^Show Trash/],
    ['logout', /^Lock Vault/],
    ['assign tag', /^Tag note with/],
    ['untag', /^Remove tag from note/]
  ])('"%s" finds %s', (query, command) => {
    useVaultStore.setState({ activeNoteId: 'n-1', noteTagsMap: { 'n-1': ['t-1'] } })
    openPalette([note('n-1', 'zzz')])
    type(query)
    expect(screen.queryByRole('option', { name: command })).not.toBeNull()
  })
})
