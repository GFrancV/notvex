// Long past any create round trip: past it the keyboard is handed back.
const CAPTURE_LIMIT_MS = 2000

// Keys typed while a new note's title input doesn't exist yet; null when not capturing.
let buffer: string | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function capture(e: KeyboardEvent): void {
  if (buffer === null || e.isComposing || e.key.length !== 1) return
  // AltGr reports as Ctrl+Alt on Windows, and it types characters like @ on many layouts.
  if (e.metaKey || ((e.ctrlKey || e.altKey) && !e.getModifierState('AltGraph'))) return
  // Cancelling keydown also cancels the text input, so the key reaches no other field.
  e.preventDefault()
  e.stopPropagation()
  buffer += e.key
}

export function startTypeahead(): void {
  // Keys left to pass through, like Backspace or Ctrl+V, must not edit the note still focused.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  // A second create before the first note opens keeps what was already typed.
  buffer ??= ''
  window.addEventListener('keydown', capture, true)
  clearTimeout(timer)
  timer = setTimeout(dropTypeahead, CAPTURE_LIMIT_MS)
}

/** Stops capturing and returns what was typed. */
export function takeTypeahead(): string {
  clearTimeout(timer)
  const text = buffer ?? ''
  buffer = null
  window.removeEventListener('keydown', capture, true)
  return text
}

export function dropTypeahead(): void {
  takeTypeahead()
}
