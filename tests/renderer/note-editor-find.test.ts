// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/ipc', () => {
  const ok = (): Promise<{ success: true; data: [] }> =>
    Promise.resolve({ success: true, data: [] })
  return {
    notvex: {
      platform: 'win32',
      notes: {
        get: ipc.get,
        update: ok,
        list: ok,
        counts: async () => ({ success: true, data: { live: 0, pinned: 0, trashed: 0 } })
      },
      tags: { list: ok },
      noteTags: { counts: ok, all: ok }
    }
  }
})

// CodeMirror measures text through Range rects, which jsdom doesn't implement.
Range.prototype.getClientRects = (): DOMRectList => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect()

const { NoteEditor } = await import('@/components/note-editor')
const { useVaultStore } = await import('@/store/vault.store')
const { useUiStore } = await import('@/store/ui.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

const findInput = (): HTMLElement | null => screen.queryByLabelText('Find in note')
const editorHasFocus = (): boolean =>
  document.activeElement?.classList.contains('cm-content') ?? false

function press(target: Element, init: KeyboardEventInit): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

const MOD_F = { key: 'f', keyCode: 70, ctrlKey: true }
const ESCAPE = { key: 'Escape', keyCode: 27 }
const ENTER = { key: 'Enter', keyCode: 13 }

/** An open note "one two one" with the editor mounted and focused. */
async function openNote(): Promise<EditorView> {
  ipc.get.mockResolvedValue({
    success: true,
    data: {
      id: 'a',
      title: 'A',
      content: 'one two one',
      isPinned: false,
      isTrashed: false,
      createdAt: 0,
      updatedAt: 0,
      trashedAt: null,
      tags: []
    }
  })
  act(() => useVaultStore.getState().setActiveNoteId('a'))
  render(createElement(NoteEditor), { wrapper: TooltipProvider })
  await waitFor(() => expect(editorHasFocus()).toBe(true))
  return EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
}

beforeEach(() => {
  ipc.get.mockReset()
  useVaultStore.setState({ activeNoteId: null, notes: [], tags: [], noteTagsMap: {} })
  useUiStore.setState({ editorMode: 'editing' })
})

afterEach(cleanup)

describe('NoteEditor — find bar', () => {
  it('opens on Ctrl+F with focus in its input', async () => {
    const cm = await openNote()
    press(cm.contentDOM, MOD_F)
    expect(findInput()).not.toBeNull()
    expect(document.activeElement).toBe(findInput())
  })

  it('closes on Escape in its input and returns focus to the editor', async () => {
    const cm = await openNote()
    press(cm.contentDOM, MOD_F)
    press(findInput()!, ESCAPE)
    expect(findInput()).toBeNull()
    expect(editorHasFocus()).toBe(true)
    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })

  it('closes from its close button and returns focus to the editor', async () => {
    const cm = await openNote()
    press(cm.contentDOM, MOD_F)
    fireEvent.click(screen.getByRole('button', { name: 'Close find' }))
    expect(findInput()).toBeNull()
    expect(editorHasFocus()).toBe(true)
    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })

  it('closes before the note on Escape in the document', async () => {
    const cm = await openNote()
    press(cm.contentDOM, MOD_F)
    act(() => cm.focus())

    press(cm.contentDOM, ESCAPE)
    expect(findInput()).toBeNull()
    expect(useVaultStore.getState().activeNoteId).toBe('a')

    press(cm.contentDOM, ESCAPE)
    expect(useVaultStore.getState().activeNoteId).toBeNull()
  })

  /** The bar open on "one two one" with `text` typed in. */
  async function find(text: string): Promise<EditorView> {
    const cm = await openNote()
    press(cm.contentDOM, MOD_F)
    fireEvent.change(findInput()!, { target: { value: text } })
    return cm
  }

  const selected = (cm: EditorView): [number, number] => [
    cm.state.selection.main.from,
    cm.state.selection.main.to
  ]

  it('counts the matches before any is selected', async () => {
    await find('one')
    expect(screen.getByText('0 / 2')).toBeTruthy()
  })

  it('walks the matches with Enter and Shift+Enter, wrapping at both ends', async () => {
    const cm = await find('one')

    press(findInput()!, ENTER)
    expect(selected(cm)).toEqual([0, 3])
    expect(screen.getByText('1 / 2')).toBeTruthy()

    press(findInput()!, ENTER)
    expect(selected(cm)).toEqual([8, 11])
    expect(screen.getByText('2 / 2')).toBeTruthy()

    press(findInput()!, ENTER)
    expect(screen.getByText('1 / 2')).toBeTruthy()

    press(findInput()!, { ...ENTER, shiftKey: true })
    expect(screen.getByText('2 / 2')).toBeTruthy()
  })

  it('walks the matches with the next and previous buttons', async () => {
    const cm = await find('one')
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(selected(cm)).toEqual([0, 3])
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(selected(cm)).toEqual([8, 11])
  })

  it('closes on Escape from one of its buttons', async () => {
    await find('one')
    const next = screen.getByRole('button', { name: 'Next match' })
    act(() => next.focus())
    press(next, ESCAPE)
    expect(findInput()).toBeNull()
    expect(editorHasFocus()).toBe(true)
    expect(useVaultStore.getState().activeNoteId).toBe('a')
  })

  it('says so when nothing matches', async () => {
    await find('nope')
    expect(screen.getByText('No results')).toBeTruthy()
  })

  it('shows no counter for an empty query', async () => {
    await find('')
    expect(screen.queryByText(/\d+ \/ \d+|No results/)).toBeNull()
  })

  it('recounts when the document changes', async () => {
    const cm = await find('one')
    act(() => cm.dispatch({ changes: { from: cm.state.doc.length, insert: ' one' } }))
    expect(screen.getByText('0 / 3')).toBeTruthy()
  })

  it('does nothing on Ctrl+F in reading mode', async () => {
    await openNote()
    act(() => useUiStore.setState({ editorMode: 'reading' }))
    press(document.body, MOD_F)
    expect(findInput()).toBeNull()
  })

  it('matches backslashes literally', async () => {
    const cm = await find('one')
    act(() => cm.dispatch({ changes: { from: 0, insert: 'C:\\temp ' } }))
    fireEvent.change(findInput()!, { target: { value: 'C:\\temp' } })
    expect(screen.getByText('0 / 1')).toBeTruthy()
  })

  it('reopens with the last query selected, and Ctrl+F refocuses an open bar', async () => {
    const cm = await find('one')
    press(findInput()!, ESCAPE)
    press(cm.contentDOM, MOD_F)
    const input = findInput() as HTMLInputElement
    expect(input.value).toBe('one')
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3])

    act(() => cm.focus())
    press(cm.contentDOM, MOD_F)
    expect(document.activeElement).toBe(findInput())
  })

  it('leaves Ctrl+Shift+F to the sidebar search', async () => {
    const cm = await openNote()
    press(cm.contentDOM, { key: 'F', keyCode: 70, ctrlKey: true, shiftKey: true })
    expect(findInput()).toBeNull()
  })

  it('closes the note on Escape in the title even with the bar open', async () => {
    const cm = await openNote()
    press(cm.contentDOM, MOD_F)
    const title = screen.getByLabelText('Note title')
    act(() => title.focus())
    press(title, ESCAPE)
    expect(useVaultStore.getState().activeNoteId).toBeNull()
  })

  it('tears down cleanly when the editor goes away with the bar open', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cm = await openNote()
    press(cm.contentDOM, MOD_F)
    act(() => useUiStore.setState({ editorMode: 'reading' }))
    await act(async () => {})
    expect(findInput()).toBeNull()

    act(() => useUiStore.setState({ editorMode: 'editing' }))
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull())
    const next = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
    press(next.contentDOM, MOD_F)
    expect(findInput()).not.toBeNull()

    act(() => useVaultStore.getState().setActiveNoteId(null))
    await act(async () => {})
    expect(findInput()).toBeNull()
    // jsdom doesn't know <search>; Chromium does.
    const unexpected = errors.mock.calls.filter(
      ([msg]) => !String(msg).includes('is unrecognized in this browser')
    )
    expect(unexpected).toEqual([])
    errors.mockRestore()
  })
})
