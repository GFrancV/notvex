import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron 44 made clipboard.readText() async. Compared synchronously,
// the Promise never equals the copied string and the clipboard is never cleared.

const clipboard = {
  readText: vi.fn<() => Promise<string>>(),
  clear: vi.fn(),
  write: vi.fn<(items: { items: Record<string, unknown> }[]) => Promise<void>>()
}
const prefs = { clipboardClearSeconds: 10, clearClipboardOnLock: true }

class ClipboardItem {
  constructor(readonly items: Record<string, unknown>) {}
}

vi.mock('electron', () => ({ clipboard, ClipboardItem }))
vi.mock('@main/prefs', () => ({ getPrefs: () => prefs }))

describe('scheduleClipboardClear', () => {
  let scheduleClipboardClear: typeof import('@main/clipboard-guard').scheduleClipboardClear

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    clipboard.readText.mockReset()
    clipboard.clear.mockReset()
    ;({ scheduleClipboardClear } = await import('@main/clipboard-guard'))
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
    for (const arg of error.mock.calls[0])
      expect(String(arg)).not.toContain('clipboard unavailable')
    error.mockRestore()
  })
})

const RAW_FORMAT = (name: string): string => `electron application/osclipboard;format="${name}"`

describe('writeClipboard', () => {
  let writeClipboard: typeof import('@main/clipboard-guard').writeClipboard
  let clearClipboardIfOurs: typeof import('@main/clipboard-guard').clearClipboardIfOurs

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    clipboard.readText.mockReset().mockResolvedValue('secret')
    clipboard.clear.mockReset()
    clipboard.write.mockReset().mockResolvedValue(undefined)
    prefs.clipboardClearSeconds = 10
    prefs.clearClipboardOnLock = true
    ;({ writeClipboard, clearClipboardIfOurs } = await import('@main/clipboard-guard'))
  })

  it('keeps the 30 s clear when the same secret is copied again as plain text', async () => {
    prefs.clipboardClearSeconds = 0
    await writeClipboard('secret', { secret: true })
    await writeClipboard('secret')

    await vi.advanceTimersByTimeAsync(30_000)

    expect(clipboard.clear).toHaveBeenCalledOnce()
  })

  it('keeps the pending secret clear when a later write fails', async () => {
    prefs.clipboardClearSeconds = 0
    await writeClipboard('secret', { secret: true })
    clipboard.write.mockRejectedValueOnce(new Error('clipboard busy'))
    await expect(writeClipboard('other')).rejects.toThrow()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(clipboard.clear).toHaveBeenCalledOnce()
  })

  // A locked vault must not leave its content behind, and the clear timer dies with the process.
  describe('clearClipboardIfOurs', () => {
    it('clears a note still on the clipboard on lock, also with the auto-clear off', async () => {
      prefs.clipboardClearSeconds = 0
      clipboard.readText.mockResolvedValue('note text')
      await writeClipboard('note text')

      await clearClipboardIfOurs('lock')

      expect(clipboard.clear).toHaveBeenCalledOnce()
    })

    it('leaves the clipboard alone once the user copied something else elsewhere', async () => {
      await writeClipboard('note text')
      clipboard.readText.mockResolvedValue('copied in another app')

      await clearClipboardIfOurs('lock')

      expect(clipboard.clear).not.toHaveBeenCalled()
    })

    it('cancels the timed clear once it cleared', async () => {
      clipboard.readText.mockResolvedValue('note text')
      await writeClipboard('note text')
      await clearClipboardIfOurs('lock')
      clipboard.readText.mockClear()

      await vi.advanceTimersByTimeAsync(10_000)

      expect(clipboard.readText).not.toHaveBeenCalled()
      expect(clipboard.clear).toHaveBeenCalledOnce()
    })

    it.each(['lock', 'quit'] as const)(
      'on %s, leaves a note to its timed clear when clearing on lock is off',
      async (reason) => {
        prefs.clearClipboardOnLock = false
        clipboard.readText.mockResolvedValue('note text')
        await writeClipboard('note text')

        await clearClipboardIfOurs(reason)
        expect(clipboard.clear).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(10_000)
        expect(clipboard.clear).toHaveBeenCalledOnce()
      }
    )

    it('treats a note that replaced the secret as a note', async () => {
      prefs.clearClipboardOnLock = false
      await writeClipboard('secret', { secret: true })
      await writeClipboard('note text')
      clipboard.readText.mockResolvedValue('note text')

      await clearClipboardIfOurs('quit')

      expect(clipboard.clear).not.toHaveBeenCalled()
    })

    // The recovery key is shown once: a lock must not wipe it before the user pastes it.
    it('leaves a secret to its 30 s clear on lock', async () => {
      await writeClipboard('secret', { secret: true })

      await clearClipboardIfOurs('lock')
      expect(clipboard.clear).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(30_000)
      expect(clipboard.clear).toHaveBeenCalledOnce()
    })

    it.each([true, false])(
      'clears a secret still on the clipboard on quit (clearing on lock: %s)',
      async (clearClipboardOnLock) => {
        prefs.clearClipboardOnLock = clearClipboardOnLock
        await writeClipboard('secret', { secret: true })

        await clearClipboardIfOurs('quit')

        expect(clipboard.clear).toHaveBeenCalledOnce()
      }
    )

    it('clears a secret on quit even after a lock left it', async () => {
      await writeClipboard('secret', { secret: true })
      await clearClipboardIfOurs('lock')

      await clearClipboardIfOurs('quit')

      expect(clipboard.clear).toHaveBeenCalledOnce()
    })

    it('does nothing once the timed clear already ran', async () => {
      await writeClipboard('secret', { secret: true })
      await vi.advanceTimersByTimeAsync(30_000)
      clipboard.clear.mockClear()

      await clearClipboardIfOurs('quit')

      expect(clipboard.clear).not.toHaveBeenCalled()
    })

    it('never throws, so it cannot block quitting', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      await writeClipboard('secret', { secret: true })
      clipboard.readText.mockRejectedValue(new Error('clipboard unavailable'))

      await expect(clearClipboardIfOurs('quit')).resolves.toBeUndefined()
      error.mockRestore()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The OS decides history and cloud-sync membership when the item is written, so the
  // markers only work if they arrive in the same write as the text.
  it('writes the text and every opt-out marker as one item in one write', async () => {
    await writeClipboard('secret')

    expect(clipboard.write).toHaveBeenCalledOnce()
    const [items] = clipboard.write.mock.calls[0]
    expect(items).toHaveLength(1)
    expect(Object.keys(items[0].items).sort()).toEqual(
      [
        'text/plain',
        RAW_FORMAT('ExcludeClipboardContentFromMonitorProcessing'),
        RAW_FORMAT('CanIncludeInClipboardHistory'),
        RAW_FORMAT('CanUploadToCloudClipboard'),
        RAW_FORMAT('org.nspasteboard.ConcealedType'),
        'x-kde-passwordManagerHint'
      ].sort()
    )
    expect(items[0].items['text/plain']).toBe('secret')
    expect(items[0].items['x-kde-passwordManagerHint']).toBe('secret')
  })

  it('writes DWORD 0 for the Windows history and cloud flags', async () => {
    await writeClipboard('secret')

    const { items } = clipboard.write.mock.calls[0][0][0]
    for (const name of ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard']) {
      const blob = items[RAW_FORMAT(name)] as Blob
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 0, 0, 0]))
    }
  })

  it('clears after the preference delay', async () => {
    await writeClipboard('secret')

    await vi.advanceTimersByTimeAsync(10_000)

    expect(clipboard.clear).toHaveBeenCalledOnce()
  })

  it('does not clear when the preference is off', async () => {
    prefs.clipboardClearSeconds = 0
    await writeClipboard('secret')

    await vi.advanceTimersByTimeAsync(600_000)

    expect(clipboard.clear).not.toHaveBeenCalled()
  })

  it('clears a secret after 30 s even when the preference is off', async () => {
    prefs.clipboardClearSeconds = 0
    await writeClipboard('secret', { secret: true })

    await vi.advanceTimersByTimeAsync(30_000)

    expect(clipboard.clear).toHaveBeenCalledOnce()
  })

  it('clears a secret after 30 s even when the preference is longer', async () => {
    prefs.clipboardClearSeconds = 300
    await writeClipboard('secret', { secret: true })

    await vi.advanceTimersByTimeAsync(29_999)
    expect(clipboard.clear).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(clipboard.clear).toHaveBeenCalledOnce()
  })
})
