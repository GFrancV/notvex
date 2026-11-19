// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  chooseFile: vi.fn().mockResolvedValue({ success: true, data: '/vaults/a.nvx' }),
  hasVault: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({ notvex: { vault: ipc } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }))

const { usePickVault } = await import('@/hooks/use-pick-vault')
const { toast } = await import('sonner')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('usePickVault', () => {
  it('rejects a refused file with the reason main gives', async () => {
    ipc.hasVault.mockResolvedValue({
      success: false,
      error: 'Vaults on network shares are not supported'
    })
    const { result } = renderHook(() => usePickVault())

    expect(await result.current.pickExistingVault()).toBeNull()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      'Vaults on network shares are not supported'
    )
  })

  it.each([
    [
      'missing',
      "Couldn't find this vault",
      "a.nvx isn't at /vaults/a.nvx. It may have been moved, renamed or be on a disconnected drive."
    ],
    [
      'not-vault',
      "Couldn't open this vault",
      "The file at /vaults/a.nvx isn't a Notvex vault. It may have been replaced by another file."
    ],
    [
      'unreadable',
      "Couldn't open this vault",
      "Notvex can't read /vaults/a.nvx. Check that it isn't open in another program and that you can access it."
    ]
  ])(
    'says why a %s file was rejected, as a title and a description',
    async (status, title, body) => {
      ipc.hasVault.mockResolvedValue({ success: true, data: status })
      const { result } = renderHook(() => usePickVault())

      expect(await result.current.pickExistingVault()).toBeNull()
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(title, { description: body })
    }
  )
})

describe('usePickVault.pickNewVault', () => {
  it('returns the chosen path when the file is not a vault yet', async () => {
    ipc.chooseFile.mockResolvedValue({ success: true, data: '/vaults/new.nvx' })
    ipc.hasVault.mockResolvedValue({ success: true, data: 'missing' })
    const { result } = renderHook(() => usePickVault())

    expect(await result.current.pickNewVault(vi.fn())).toBe('/vaults/new.nvx')
    expect(ipc.chooseFile).toHaveBeenCalledExactlyOnceWith('new')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('returns null and shows nothing when the dialog is cancelled', async () => {
    ipc.chooseFile.mockResolvedValue({ success: true, data: null })
    const { result } = renderHook(() => usePickVault())

    expect(await result.current.pickNewVault(vi.fn())).toBeNull()
    expect(ipc.hasVault).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('refuses a file that is already a vault with an error that stays until dismissed', async () => {
    ipc.chooseFile.mockResolvedValue({ success: true, data: '/vaults/a.nvx' })
    ipc.hasVault.mockResolvedValue({ success: true, data: 'usable' })
    const { result } = renderHook(() => usePickVault())

    expect(await result.current.pickNewVault(vi.fn())).toBeNull()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      'That file is already a Notvex vault',
      expect.objectContaining({
        description: 'vaults • a.nvx',
        duration: Infinity,
        closeButton: true
      })
    )
  })

  it('hands the existing vault to the caller when "Open it" is pressed', async () => {
    ipc.chooseFile.mockResolvedValue({ success: true, data: '/vaults/a.nvx' })
    ipc.hasVault.mockResolvedValue({ success: true, data: 'usable' })
    const onOpenExisting = vi.fn()
    const { result } = renderHook(() => usePickVault())

    await result.current.pickNewVault(onOpenExisting)

    const options = vi.mocked(toast.error).mock.calls[0][1] as {
      action: { label: string; onClick: () => void }
    }
    expect(options.action.label).toBe('Open it')
    expect(onOpenExisting).not.toHaveBeenCalled()
    options.action.onClick()
    expect(onOpenExisting).toHaveBeenCalledExactlyOnceWith('/vaults/a.nvx')
  })

  it('takes the refusal away when the screen that raised it goes away', async () => {
    ipc.chooseFile.mockResolvedValue({ success: true, data: '/vaults/a.nvx' })
    ipc.hasVault.mockResolvedValue({ success: true, data: 'usable' })
    const { result, unmount } = renderHook(() => usePickVault())
    await result.current.pickNewVault(vi.fn())

    const options = vi.mocked(toast.error).mock.calls[0][1] as { id: string }
    expect(toast.dismiss).not.toHaveBeenCalled()
    unmount()
    expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith(options.id)
  })

  it('takes a refusal away once another file is chosen for the new vault', async () => {
    ipc.chooseFile.mockResolvedValueOnce({ success: true, data: '/vaults/a.nvx' })
    ipc.hasVault.mockResolvedValueOnce({ success: true, data: 'usable' })
    const { result } = renderHook(() => usePickVault())
    await result.current.pickNewVault(vi.fn())
    const options = vi.mocked(toast.error).mock.calls[0][1] as { id: string }
    expect(toast.dismiss).not.toHaveBeenCalled()

    ipc.chooseFile.mockResolvedValueOnce({ success: true, data: '/vaults/new.nvx' })
    ipc.hasVault.mockResolvedValueOnce({ success: true, data: 'missing' })
    expect(await result.current.pickNewVault(vi.fn())).toBe('/vaults/new.nvx')

    expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith(options.id)
  })

  it('shows one refusal at a time', async () => {
    ipc.chooseFile.mockResolvedValue({ success: true, data: '/vaults/a.nvx' })
    ipc.hasVault.mockResolvedValue({ success: true, data: 'usable' })
    const { result } = renderHook(() => usePickVault())
    await result.current.pickNewVault(vi.fn())
    await result.current.pickNewVault(vi.fn())

    const [first, second] = vi
      .mocked(toast.error)
      .mock.calls.map((c) => (c[1] as { id: string }).id)
    expect(first).toBeTruthy()
    expect(second).toBe(first)
  })
})
