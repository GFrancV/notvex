// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/ipc', () => {
  const ok = (): Promise<{ success: true; data: [] }> =>
    Promise.resolve({ success: true, data: [] })
  return {
    notvex: {
      platform: 'win32',
      notes: { get: ipc.get, update: ok, list: ok },
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
  render(createElement(NoteEditor))
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

  it('does nothing on Ctrl+F in reading mode', async () => {
    await openNote()
    act(() => useUiStore.setState({ editorMode: 'reading' }))
    press(document.body, MOD_F)
    expect(findInput()).toBeNull()
  })
})
