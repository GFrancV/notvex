// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  status: vi.fn(),
  reloadWindow: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    vault: { status: ipc.status },
    app: { reloadWindow: ipc.reloadWindow }
  }
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { ReloadWindowDialog } = await import('@/components/dialogs/ReloadWindowDialog')
const { requestReload } = await import('@/lib/reload-window')
const { useUiStore } = await import('@/store/ui.store')
const { toast } = await import('sonner')

const DIALOG_TITLE = /reload window\?/i

function vaultOpen(isOpen: boolean): void {
  ipc.status.mockResolvedValue({
    success: true,
    data: isOpen ? { isOpen, vaultPath: '/v.nvx' } : { isOpen }
  })
}

async function requestWithDialogMounted(): Promise<void> {
  render(createElement(ReloadWindowDialog))
  await act(() => requestReload())
}

beforeEach(() => {
  useUiStore.setState({ reloadConfirmOpen: false })
  ipc.reloadWindow.mockResolvedValue({ success: true, data: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('requestReload', () => {
  it('asks for confirmation when a vault is open', async () => {
    vaultOpen(true)
    await requestWithDialogMounted()

    expect(screen.getByText(DIALOG_TITLE)).not.toBeNull()
    expect(ipc.reloadWindow).not.toHaveBeenCalled()
  })

  it('reloads without asking when no vault is open', async () => {
    vaultOpen(false)
    await requestWithDialogMounted()

    expect(ipc.reloadWindow).toHaveBeenCalledOnce()
    expect(screen.queryByText(DIALOG_TITLE)).toBeNull()
  })

  // Reloading an open vault unasked is the one outcome to avoid, so an unknown state asks.
  it('asks for confirmation when the vault status is unknown', async () => {
    ipc.status.mockResolvedValue({ success: false, error: 'boom' })
    await requestWithDialogMounted()

    expect(screen.getByText(DIALOG_TITLE)).not.toBeNull()
    expect(ipc.reloadWindow).not.toHaveBeenCalled()
  })

  it('shows an error when the reload fails', async () => {
    vaultOpen(false)
    ipc.reloadWindow.mockResolvedValue({ success: false, error: 'disk full' })
    await requestWithDialogMounted()

    expect(toast.error).toHaveBeenCalledWith('disk full')
  })
})

describe('ReloadWindowDialog', () => {
  beforeEach(() => vaultOpen(true))

  it('Cancel closes the dialog without reloading', async () => {
    await requestWithDialogMounted()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull())
    expect(ipc.reloadWindow).not.toHaveBeenCalled()
  })

  it('focuses Cancel, not the reload', async () => {
    await requestWithDialogMounted()

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /cancel/i }))
    )
  })

  it('"Reload and lock" reloads', async () => {
    await requestWithDialogMounted()

    fireEvent.click(screen.getByRole('button', { name: /reload and lock/i }))

    await waitFor(() => expect(ipc.reloadWindow).toHaveBeenCalledOnce())
  })

  it('closes and shows an error when the confirmed reload fails', async () => {
    ipc.reloadWindow.mockResolvedValue({ success: false, error: 'disk full' })
    await requestWithDialogMounted()

    fireEvent.click(screen.getByRole('button', { name: /reload and lock/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('disk full'))
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull())
  })
})
