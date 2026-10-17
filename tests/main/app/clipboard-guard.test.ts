import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron 44 made clipboard.readText() async. Compared synchronously,
// the Promise never equals the copied string and the clipboard is never cleared.

const clipboard = {
  readText: vi.fn<() => Promise<string>>(),
  clear: vi.fn(),
  write: vi.fn<(items: { items: Record<string, unknown> }[]) => Promise<void>>()
}
const prefs = { clipboardClearSeconds: 10 }

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
  let clearPendingSecret: typeof import('@main/clipboard-guard').clearPendingSecret

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    clipboard.readText.mockReset().mockResolvedValue('secret')
    clipboard.clear.mockReset()
    clipboard.write.mockReset().mockResolvedValue(undefined)
    prefs.clipboardClearSeconds = 10
    ;({ writeClipboard, clearPendingSecret } = await import('@main/clipboard-guard'))
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

  // The clear timer dies with the process, so quitting must not leave the recovery key behind.
  describe('clearPendingSecret', () => {
    it('clears a secret still on the clipboard', async () => {
      await writeClipboard('secret', { secret: true })

      await clearPendingSecret()

      expect(clipboard.clear).toHaveBeenCalledOnce()
    })

    it('leaves the clipboard alone once the user copied something else elsewhere', async () => {
      await writeClipboard('secret', { secret: true })
      clipboard.readText.mockResolvedValue('copied in another app')

      await clearPendingSecret()

      expect(clipboard.clear).not.toHaveBeenCalled()
    })

    it('does nothing when the last copy was not a secret', async () => {
      await writeClipboard('secret', { secret: true })
      await writeClipboard('note text')

      await clearPendingSecret()

      expect(clipboard.clear).not.toHaveBeenCalled()
    })

    it('does nothing once the timed clear already ran', async () => {
      await writeClipboard('secret', { secret: true })
      await vi.advanceTimersByTimeAsync(30_000)
      clipboard.clear.mockClear()

      await clearPendingSecret()

      expect(clipboard.clear).not.toHaveBeenCalled()
    })

    it('never throws, so it cannot block quitting', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      await writeClipboard('secret', { secret: true })
      clipboard.readText.mockRejectedValue(new Error('clipboard unavailable'))

      await expect(clearPendingSecret()).resolves.toBeUndefined()
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
