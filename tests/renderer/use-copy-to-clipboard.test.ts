// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Every programmatic copy goes through main, which adds the clipboard-history opt-out markers
// and schedules the auto-clear; the renderer never writes the clipboard itself.

const write = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({ notvex: { clipboard: { write } } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { useCopyToClipboard } = await import('@/hooks/use-copy-to-clipboard')
const { toast } = await import('sonner')

beforeEach(() => {
  vi.clearAllMocks()
  write.mockResolvedValue({ success: true, data: null })
})

describe('useCopyToClipboard', () => {
  it('writes through main as a non-secret by default', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copyToClipboard('hello'))

    expect(write).toHaveBeenCalledExactlyOnceWith('hello', { secret: false })
    expect(toast.success).toHaveBeenCalledOnce()
    expect(result.current.isCopied).toBe(true)
  })

  it('passes the secret flag to main', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copyToClipboard('words', { secret: true }))

    expect(write).toHaveBeenCalledExactlyOnceWith('words', { secret: true })
  })

  it('reports a refused write as a failed copy', async () => {
    write.mockResolvedValue({ success: false, error: 'Invalid clipboard value' })
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copyToClipboard('hello'))

    expect(toast.error).toHaveBeenCalledOnce()
    expect(toast.success).not.toHaveBeenCalled()
    expect(result.current.isCopied).toBe(false)
  })

  // Callers fire and forget the copy, so a rejected invoke would otherwise be unhandled and silent.
  it('reports a rejected IPC call as a failed copy', async () => {
    write.mockRejectedValue(new Error('No handler registered'))
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copyToClipboard('hello'))

    expect(toast.error).toHaveBeenCalledOnce()
    expect(result.current.isCopied).toBe(false)
  })

  it('does nothing for empty text', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copyToClipboard(''))

    expect(write).not.toHaveBeenCalled()
  })
})
