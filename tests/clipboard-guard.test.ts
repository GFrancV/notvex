import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron 44 made clipboard.readText() async. Compared synchronously,
// the Promise never equals the copied string and the clipboard is never cleared.

const clipboard = {
  readText: vi.fn<() => Promise<string>>(),
  clear: vi.fn()
}

vi.mock('electron', () => ({ clipboard }))
vi.mock('../src/main/prefs', () => ({ getPrefs: () => ({ clipboardClearSeconds: 10 }) }))

describe('scheduleClipboardClear', () => {
  let scheduleClipboardClear: typeof import('../src/main/clipboard-guard').scheduleClipboardClear

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    clipboard.readText.mockReset()
    clipboard.clear.mockReset()
    ;({ scheduleClipboardClear } = await import('../src/main/clipboard-guard'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the clipboard when it still holds the copied value', async () => {
    clipboard.readText.mockResolvedValue('secret')
    scheduleClipboardClear('secret')

    await vi.advanceTimersByTimeAsync(10_000)

    expect(clipboard.clear).toHaveBeenCalledOnce()
  })

  it('leaves the clipboard alone when the user copied something else since', async () => {
    clipboard.readText.mockResolvedValue('something else')
    scheduleClipboardClear('secret')

    await vi.advanceTimersByTimeAsync(10_000)

    expect(clipboard.clear).not.toHaveBeenCalled()
  })

  it('only the latest copy is armed', async () => {
    clipboard.readText.mockResolvedValue('first')
    scheduleClipboardClear('first')
    scheduleClipboardClear('second')

    await vi.advanceTimersByTimeAsync(10_000)

    expect(clipboard.clear).not.toHaveBeenCalled()
  })

  it('a failed clipboard read does not escape as an unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    clipboard.readText.mockRejectedValue(new Error('clipboard unavailable'))
    scheduleClipboardClear('secret')

    await vi.advanceTimersByTimeAsync(10_000)

    expect(clipboard.clear).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
