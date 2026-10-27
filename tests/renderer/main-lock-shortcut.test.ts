// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ctrl+L is a soft lock: while Settings is changing the credentials, or showing the recovery key
// that change produced, it must wait. Closing the vault then would lose a key nobody wrote down.

const close = vi.hoisted(() => vi.fn(async () => ({ success: true, data: null })))

vi.mock('@/lib/ipc', () => ({
  notvex: { vault: { close }, onWillLock: () => () => {} }
}))
vi.mock('@/components/command-palette', () => ({ CommandPalette: () => null }))
vi.mock('@/components/dialogs/RecoveryKeyUnconfirmedDialog', () => ({
  RecoveryKeyUnconfirmedDialog: () => null
}))
vi.mock('@/components/note-editor', () => ({ NoteEditor: () => null }))
vi.mock('@/components/note-list', () => ({ NoteList: () => null }))
vi.mock('@/components/sidebar', () => ({ Sidebar: () => null }))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: unknown }) => children,
  SidebarInset: ({ children }: { children: unknown }) => children
}))

const { Main } = await import('@/views/main')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')
const { TooltipProvider } = await import('@/components/ui/tooltip')

async function pressCtrlL(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
  })
}

beforeEach(() => {
  useVaultStore.setState({ status: 'unlocked', refreshAll: async () => {} })
  render(createElement(Main), { wrapper: TooltipProvider })
})

afterEach(() => {
  cleanup()
  useUiStore.setState({ settingsLocked: false })
  vi.clearAllMocks()
})

describe('Main: Ctrl+L', () => {
  it('locks the vault', async () => {
    await pressCtrlL()

    expect(close).toHaveBeenCalledOnce()
    expect(useVaultStore.getState().status).toBe('locked')
  })

  it('waits while Settings is changing the credentials or showing the new key', async () => {
    useUiStore.setState({ settingsLocked: true })

    await pressCtrlL()

    expect(close).not.toHaveBeenCalled()
    expect(useVaultStore.getState().status).toBe('unlocked')
  })

  it('is released by any lock, so the next session can lock with it again', async () => {
    useUiStore.setState({ settingsLocked: true })

    act(() => useVaultStore.getState().clearSession())

    expect(useUiStore.getState().settingsLocked).toBe(false)
  })
})
