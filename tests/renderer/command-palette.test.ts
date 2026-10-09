// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem } from '@shared/types'

const created = (title: string): NoteListItem => ({
  id: 'n-new',
  title,
  isPinned: false,
  isTrashed: false,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null,
  tags: []
})

vi.mock('@/lib/ipc', () => ({ notvex: {} }))

const { useCreateNote } = await import('@/hooks/use-create-note')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

const createNote = vi.fn((input?: { title: string }) =>
  Promise.resolve(created(input?.title ?? 'Untitled'))
)

beforeEach(() => {
  useVaultStore.setState({ createNote, activeNoteId: null })
  useUiStore.setState({ searchQuery: '' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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
