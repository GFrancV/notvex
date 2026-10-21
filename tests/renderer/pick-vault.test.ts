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
  it.each([
    [
      'refused',
      { success: false, error: 'Vaults on network shares are not supported' },
      'Vaults on network shares are not supported'
    ],
    ['not a vault', { success: true, data: false }, 'This file is not a valid Notvex vault']
  ])('rejects a file that is %s and says why', async (_label, res, message) => {
    ipc.hasVault.mockResolvedValue(res)
    const { result } = renderHook(() => usePickVault())

    expect(await result.current.pickExistingVault()).toBeNull()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message)
  })
})
