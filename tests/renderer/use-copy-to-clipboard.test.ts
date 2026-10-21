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
const { useVaultStore } = await import('@/store/vault.store')

beforeEach(() => {
  vi.clearAllMocks()
  write.mockResolvedValue({ success: true, data: null })
  useVaultStore.setState({ status: 'locked' })
})

describe('useCopyToClipboard', () => {
  it('writes through main as a non-secret by default', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copyToClipboard('hello'))

    expect(write).toHaveBeenCalledExactlyOnceWith('hello', {
      secret: false,
      fromUnlockedView: false
    })
    expect(toast.success).toHaveBeenCalledOnce()
    expect(result.current.isCopied).toBe(true)
  })

  it('passes the secret flag to main', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copyToClipboard('words', { secret: true }))

    expect(write).toHaveBeenCalledExactlyOnceWith('words', {
      secret: true,
      fromUnlockedView: false
    })
  })

  // Main refuses a copy from the unlocked view once it has locked, before the renderer knows.
  // Callers like the help menu outlive a status change, so the status is read at copy time.
  it('marks a copy made once the vault is unlocked, even if mounted before', async () => {
    const { result } = renderHook(() => useCopyToClipboard())
    act(() => useVaultStore.setState({ status: 'unlocked' }))

    await act(() => result.current.copyToClipboard('note text'))

    expect(write).toHaveBeenCalledExactlyOnceWith('note text', {
      secret: false,
      fromUnlockedView: true
    })
  })

  it('stops marking copies once the vault locks, even if mounted while unlocked', async () => {
    useVaultStore.setState({ status: 'unlocked' })
    const { result } = renderHook(() => useCopyToClipboard())
    act(() => useVaultStore.setState({ status: 'locked' }))

    await act(() => result.current.copyToClipboard('hello'))

    expect(write).toHaveBeenCalledExactlyOnceWith('hello', {
      secret: false,
      fromUnlockedView: false
    })
  })

  it.each(['checking', 'uninitialized'] as const)(
    'does not mark a copy made while the vault is %s',
    async (status) => {
      useVaultStore.setState({ status })
      const { result } = renderHook(() => useCopyToClipboard())

      await act(() => result.current.copyToClipboard('hello'))

      expect(write).toHaveBeenCalledExactlyOnceWith('hello', {
        secret: false,
        fromUnlockedView: false
      })
    }
  )

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
