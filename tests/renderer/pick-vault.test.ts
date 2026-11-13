// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  chooseFile: vi.fn().mockResolvedValue({ success: true, data: '/vaults/a.nvx' }),
  hasVault: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({ notvex: { vault: ipc } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

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
