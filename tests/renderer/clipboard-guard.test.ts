// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Windows decides whether a copy enters clipboard history when it is written, so a user copy
// must never reach the clipboard through Chromium: the guard takes the text, cancels the native
// write and hands the text to main, which writes it with the opt-out markers.

const write = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({ notvex: { clipboard: { write } } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

// CodeMirror measures text through Range rects, which jsdom doesn't implement.
Range.prototype.getClientRects = (): DOMRectList => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect()

const { useClipboardGuard } = await import('@/hooks/use-clipboard-guard')
const { toast } = await import('sonner')
const { useVaultStore } = await import('@/store/vault.store')

interface FakeClipboardData {
  getData: (type: string) => string
  setData: (type: string, value: string) => void
  clearData: () => void
  types: () => string[]
}

// jsdom has no ClipboardEvent or DataTransfer; this is the slice of DataTransfer both CodeMirror
// and the guard use.
function fakeClipboardData(): FakeClipboardData {
  const store = new Map<string, string>()
  return {
    getData: (type) => store.get(type) ?? '',
    setData: (type, value) => void store.set(type, value),
    clearData: () => store.clear(),
    types: () => [...store.keys()]
  }
}

function fire(
  target: EventTarget,
  type: 'copy' | 'cut'
): { event: Event; data: FakeClipboardData } {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const data = fakeClipboardData()
  Object.defineProperty(event, 'clipboardData', { value: data })
  target.dispatchEvent(event)
  return { event, data }
}

function editor(doc: string, selection: EditorSelection): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, selection }),
    parent: document.body
  })
  view.focus()
  return view
}

// jsdom has no editing commands; every test gets a fresh stand-in.
const execCommand = vi.fn(() => true)
let unmountGuard: () => void

beforeEach(() => {
  write.mockReset().mockResolvedValue({ success: true, data: null })
  execCommand.mockClear()
  vi.mocked(toast.error).mockClear()
  useVaultStore.setState({ status: 'locked' })
  document.execCommand = execCommand
  unmountGuard = renderHook(() => useClipboardGuard()).unmount
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('copy and cut in the editor', () => {
  it('sends the line CodeMirror copies when nothing is selected', () => {
    const view = editor('first line\nsecond line', EditorSelection.single(3))

    const { event, data } = fire(view.contentDOM, 'copy')

    expect(write).toHaveBeenCalledExactlyOnceWith('first line', { fromUnlockedView: false })
    expect(event.defaultPrevented).toBe(true)
    expect(data.types()).toEqual([])
    view.destroy()
  })

  it("sends CodeMirror's full selection, not just what is rendered", () => {
    const doc = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n')
    const view = editor(doc, EditorSelection.single(0, doc.length))

    fire(view.contentDOM, 'copy')

    expect(write).toHaveBeenCalledExactlyOnceWith(doc, { fromUnlockedView: false })
    view.destroy()
  })

  it('sends the cut text and leaves the deletion to CodeMirror', () => {
    const view = editor('keep cut', EditorSelection.single(5, 8))

    fire(view.contentDOM, 'cut')

    expect(write).toHaveBeenCalledExactlyOnceWith('cut', { fromUnlockedView: false })
    expect(view.state.doc.toString()).toBe('keep ')
    expect(execCommand).not.toHaveBeenCalled()
    view.destroy()
  })
})

describe('copy and cut in plain fields', () => {
  function field(
    tag: 'input' | 'textarea',
    value: string,
    start: number,
    end: number
  ): HTMLInputElement | HTMLTextAreaElement {
    const el = document.createElement(tag)
    el.value = value
    document.body.append(el)
    el.focus()
    el.setSelectionRange(start, end)
    return el
  }

  it.each(['input', 'textarea'] as const)('sends the %s selection', (tag) => {
    const el = field(tag, 'note title', 5, 10)

    const { event } = fire(el, 'copy')

    expect(write).toHaveBeenCalledExactlyOnceWith('title', { fromUnlockedView: false })
    expect(event.defaultPrevented).toBe(true)
  })

  it('still removes the text on cut, which the cancelled native cut no longer does', () => {
    const el = field('input', 'note title', 5, 10)

    fire(el, 'cut')

    expect(write).toHaveBeenCalledExactlyOnceWith('title', { fromUnlockedView: false })
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('delete')
  })

  it('leaves a cut with nothing selected alone', () => {
    const el = field('input', 'note title', 3, 3)

    const { event } = fire(el, 'cut')

    expect(write).not.toHaveBeenCalled()
    expect(execCommand).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves password fields alone', () => {
    const el = document.createElement('input')
    el.type = 'password'
    el.value = 'hunter2'
    document.body.append(el)
    el.focus()
    el.setSelectionRange(0, 7)

    const { event } = fire(el, 'copy')

    expect(write).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('copy in rendered content', () => {
  it('sends the DOM selection', () => {
    const p = document.createElement('p')
    p.textContent = 'reading view text'
    document.body.append(p)
    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.firstChild!, 12)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)

    fire(p, 'copy')

    expect(write).toHaveBeenCalledExactlyOnceWith('reading view', { fromUnlockedView: false })
  })

  it('does nothing when there is nothing to copy', () => {
    window.getSelection()!.removeAllRanges()

    const { event } = fire(document.body, 'copy')

    expect(write).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

// The native write is already cancelled when main answers, so a failure must be visible: the
// text is on neither the clipboard nor, after a cut, in the field (undo brings it back).
describe('a copy main could not write', () => {
  function copyInField(): void {
    const el = document.createElement('input')
    el.value = 'note title'
    document.body.append(el)
    el.focus()
    el.setSelectionRange(5, 10)
    fire(el, 'copy')
  }

  it('shows an error when main refuses it', async () => {
    write.mockResolvedValue({ success: false, error: 'Invalid clipboard value' })

    copyInField()

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce())
  })

  it('shows an error when the IPC call itself fails', async () => {
    write.mockRejectedValue(new Error('No handler registered'))

    copyInField()

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce())
  })
})

// Main refuses a copy from the unlocked view once it has locked, before the renderer knows.
describe('the view a copy came from', () => {
  function copyInField(): void {
    const el = document.createElement('input')
    el.value = 'note title'
    document.body.append(el)
    el.focus()
    el.setSelectionRange(5, 10)
    fire(el, 'copy')
  }

  it('marks a copy made while the vault is unlocked', () => {
    useVaultStore.setState({ status: 'unlocked' })

    copyInField()

    expect(write).toHaveBeenCalledExactlyOnceWith('title', { fromUnlockedView: true })
  })

  // Setup runs as 'uninitialized' with no vault open; a marked copy there would be refused.
  it.each(['checking', 'uninitialized', 'locked'] as const)(
    'does not mark a copy made while the vault is %s',
    (status) => {
      useVaultStore.setState({ status })

      copyInField()

      expect(write).toHaveBeenCalledExactlyOnceWith('title', { fromUnlockedView: false })
    }
  )
})

describe('after unmount', () => {
  it('stops guarding copies', () => {
    unmountGuard()
    const el = document.createElement('input')
    el.value = 'note title'
    document.body.append(el)
    el.focus()
    el.setSelectionRange(5, 10)

    const { event } = fire(el, 'copy')

    expect(write).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
