// @vitest-environment jsdom
import { createElement } from 'react'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Note } from '@shared/types'

const ipc = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  counts: vi.fn()
}))

// CodeMirror carries no weight for the title path and is expensive in jsdom.
vi.mock('@uiw/react-codemirror', () => ({ default: (): null => null }))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    notes: {
      get: ipc.get,
      update: ipc.update,
      list: ipc.list,
      trash: vi.fn(),
      counts: vi.fn(async () => ({ success: true, data: { live: 0, pinned: 0, trashed: 0 } }))
    },
    tags: { list: vi.fn() },
    noteTags: { counts: ipc.counts, all: vi.fn() }
  }
}))

const { NoteEditor } = await import('@/components/note-editor')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

function note(id: string, title: string): Note {
  return {
    id,
    title,
    content: '',
    isPinned: false,
    isTrashed: false,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags: []
  }
}

/** A promise whose resolution this test controls, to place a race precisely. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const titleInput = (): HTMLInputElement => screen.getByLabelText('Note title') as HTMLInputElement

describe('NoteEditor — title persistence', () => {
  beforeEach(() => {
    ipc.list.mockResolvedValue({ success: true, data: [] })
    ipc.counts.mockResolvedValue({ success: true, data: {} })
    ipc.update.mockResolvedValue({ success: true, data: null })
    useVaultStore.setState({ activeNoteId: null, notes: [], tags: [], noteTagsMap: {} })
    useUiStore.getState().resetFilters()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reloads the view that is open after a title save', async () => {
    useUiStore.setState({ showTrash: true })
    ipc.get.mockResolvedValue({ success: true, data: { ...note('t', 'Old'), isTrashed: true } })
    useVaultStore.setState({ activeNoteId: 't' })

    const view = render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await waitFor(() => expect(titleInput().value).toBe('Old'))

    fireEvent.change(titleInput(), { target: { value: 'Old renamed' } })
    fireEvent.blur(titleInput())

    await waitFor(() => expect(ipc.list).toHaveBeenCalled())
    expect(ipc.list).toHaveBeenLastCalledWith({ trashed: true })
    view.unmount()
  })

  it('1 · persists a typed title without waiting for blur', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a', 'A') })
    useVaultStore.setState({ activeNoteId: 'a' })

    const view = render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await waitFor(() => expect(titleInput().value).toBe('A'))

    fireEvent.change(titleInput(), { target: { value: 'A renamed' } })

    // No blur, no focus change — just leaving the editor.
    view.unmount()

    await waitFor(() => expect(ipc.update).toHaveBeenCalledWith('a', { title: 'A renamed' }))
  })

  it('2 · a note switch does not corrupt the next note’s unchanged-title guard', async () => {
    // The race: the flush fired by the switch resolves *after* the next note
    // has loaded and recorded its own persisted title. If that late resolution
    // is allowed to overwrite the record, the guard then compares against the
    // previous note's title and silently skips a legitimate save.
    ipc.get.mockResolvedValue({ success: true, data: note('a', 'A') })
    useVaultStore.setState({ activeNoteId: 'a' })

    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await waitFor(() => expect(titleInput().value).toBe('A'))

    const slowSave = deferred<{ success: true; data: null }>()
    ipc.update.mockReturnValueOnce(slowSave.promise)
    fireEvent.change(titleInput(), { target: { value: 'A renamed' } })

    // Switch to a note that happens to share the title we just typed.
    ipc.get.mockResolvedValue({ success: true, data: note('b', 'B') })
    useVaultStore.setState({ activeNoteId: 'b' })
    await waitFor(() => expect(titleInput().value).toBe('B'))

    // Only now does note A's save land, after B recorded its own title.
    slowSave.resolve({ success: true, data: null })
    await waitFor(() => expect(ipc.update).toHaveBeenCalledWith('a', { title: 'A renamed' }))

    ipc.update.mockClear()
    fireEvent.change(titleInput(), { target: { value: 'A renamed' } })
    fireEvent.blur(titleInput())

    // B's rename must still be written. Left uncorrected, the guard holds
    // "A renamed" as B's persisted title and drops this write entirely.
    await waitFor(() => expect(ipc.update).toHaveBeenCalledWith('b', { title: 'A renamed' }))
  })
})
