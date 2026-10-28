// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Note } from '@shared/types'

const ipc = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  counts: vi.fn()
}))

const countSpy = vi.hoisted(() => vi.fn())

// A textarea stands in for CodeMirror: only the value/onChange contract matters here.
vi.mock('@uiw/react-codemirror', async () => {
  const { createElement: h } = await import('react')
  return {
    default: (props: { value: string; onChange: (v: string) => void }) =>
      h('textarea', {
        'aria-label': 'Note body',
        value: props.value,
        onChange: (e: { target: { value: string } }) => props.onChange(e.target.value)
      })
  }
})

vi.mock('@/lib/text-count', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/text-count')>()
  return {
    ...actual,
    countText: (content: string) => {
      countSpy(content)
      return actual.countText(content)
    }
  }
})

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
const { useVaultStore } = await import('@/store/vault.store')
const { useUiStore } = await import('@/store/ui.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

function note(id: string, content: string): Note {
  return {
    id,
    title: id.toUpperCase(),
    content,
    isPinned: false,
    isTrashed: false,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags: []
  }
}

// Testing Library's waitFor stalls while setTimeout is faked, so timers are faked only once
// the note has loaded, and later async work is drained through act instead.
function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

const body = (): HTMLTextAreaElement => screen.getByLabelText('Note body') as HTMLTextAreaElement

describe('NoteEditor — word/character count', () => {
  beforeEach(() => {
    ipc.list.mockResolvedValue({ success: true, data: [] })
    ipc.counts.mockResolvedValue({ success: true, data: {} })
    ipc.update.mockResolvedValue({ success: true, data: null })
    useVaultStore.setState({ activeNoteId: null, notes: [], tags: [], noteTagsMap: {} })
    useUiStore.setState({ editorMode: 'editing' })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('1 · shows the count as soon as the note opens, without waiting for the debounce', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a', 'hello world') })
    useVaultStore.setState({ activeNoteId: 'a' })

    render(createElement(NoteEditor), { wrapper: TooltipProvider })

    await waitFor(() => expect(screen.getByText('2 words · 11 characters')).toBeTruthy())
  })

  it('2 · a burst of keystrokes recomputes once, after the pause', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a', 'x') })
    useVaultStore.setState({ activeNoteId: 'a' })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await waitFor(() => expect(screen.getByText('1 word · 1 character')).toBeTruthy())
    fakeTimers()
    countSpy.mockClear()

    fireEvent.change(body(), { target: { value: 'x y' } })
    fireEvent.change(body(), { target: { value: 'x y z' } })
    fireEvent.change(body(), { target: { value: 'x y z w' } })
    act(() => void vi.advanceTimersByTime(299))

    expect(countSpy).not.toHaveBeenCalled()
    expect(screen.getByText('1 word · 1 character')).toBeTruthy()

    act(() => void vi.advanceTimersByTime(1))

    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByText('4 words · 7 characters')).toBeTruthy()
  })

  it('3 · a timer left pending by the previous note never overwrites the next note’s count', async () => {
    ipc.get.mockResolvedValue({ success: true, data: note('a', 'a') })
    useVaultStore.setState({ activeNoteId: 'a' })
    render(createElement(NoteEditor), { wrapper: TooltipProvider })
    await waitFor(() => expect(body().value).toBe('a'))
    fakeTimers()

    fireEvent.change(body(), { target: { value: 'a b c d e' } })

    ipc.get.mockResolvedValue({ success: true, data: note('b', 'one two') })
    act(() => useVaultStore.setState({ activeNoteId: 'b' }))
    await settle()
    expect(screen.getByText('2 words · 7 characters')).toBeTruthy()

    act(() => void vi.advanceTimersByTime(1000))

    expect(screen.getByText('2 words · 7 characters')).toBeTruthy()
  })

  it('4 · shows the count in reading mode too', async () => {
    useUiStore.setState({ editorMode: 'reading' })
    ipc.get.mockResolvedValue({ success: true, data: note('a', 'read me') })
    useVaultStore.setState({ activeNoteId: 'a' })

    render(createElement(NoteEditor), { wrapper: TooltipProvider })

    await waitFor(() => expect(screen.getByText('2 words · 7 characters')).toBeTruthy())
  })
})
