// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem, RecentVault, Tag } from '@shared/types'

const switchTo = vi.hoisted(() => vi.fn())
const hasVault = vi.hoisted(() => vi.fn())
const prefsGet = vi.hoisted(() => vi.fn())
const removeRecentVault = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    prefs: { get: prefsGet, removeRecentVault },
    vault: { switchTo, hasVault }
  }
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { VaultSwitcher } = await import('@/components/VaultSwitcher')
const { usePrefsStore } = await import('@/store/prefs.store')
const { useVaultStore } = await import('@/store/vault.store')
const { toast } = await import('sonner')
const { TooltipProvider } = await import('@/components/ui/tooltip')

const CURRENT = 'C:/vaults/work.nvx'
const OTHER = 'C:/vaults/home.nvx'

const tag: Tag = { id: 't1', name: 'secret tag', color: '#888888', createdAt: 0 }
const note: NoteListItem = {
  id: 'n1',
  title: 'secret plan',
  isPinned: false,
  isTrashed: false,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null,
  tags: [tag]
}

async function switchToOther(): Promise<void> {
  render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
  fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: /home\.nvx/ }))
}

// Removing OTHER makes prefs.get answer with only CURRENT, as main would
async function openMenuWithOtherMissing(): Promise<void> {
  removeRecentVault.mockImplementation(async () => {
    prefsGet.mockResolvedValue({
      success: true,
      data: { recentVaults: [{ path: CURRENT, hasKeyFile: false, lastOpenedAt: 2 }] }
    })
    return { success: true, data: null }
  })
  hasVault.mockImplementation(async (path: string) => ({
    success: true,
    data: path === OTHER ? 'missing' : 'usable'
  }))
  render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
  fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })
  await screen.findByRole('menuitem', { name: /home\.nvx.*Not found/ })
}

beforeEach(() => {
  hasVault.mockResolvedValue({ success: true, data: 'usable' })
  // Failing keeps the seeded recentVaults, as when main couldn't promote the target
  prefsGet.mockResolvedValue({ success: false, error: 'not needed' })
  removeRecentVault.mockResolvedValue({ success: true, data: null })
  // jsdom closes a second Radix menu in a file on its own auto-focus (see help-menu.test.ts)
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
  usePrefsStore.setState({
    recentVaults: [
      { path: CURRENT, hasKeyFile: false, lastOpenedAt: 2 },
      { path: OTHER, hasKeyFile: false, lastOpenedAt: 1 }
    ]
  })
  useVaultStore.setState({
    status: 'unlocked',
    currentVaultPath: CURRENT,
    notes: [note],
    tags: [tag],
    tagCounts: { t1: 1 },
    noteTagsMap: { n1: ['t1'] },
    activeNoteId: 'n1',
    pendingOpenVaultPath: null
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('VaultSwitcher', () => {
  it('a switch clears the session and points Unlock at the chosen vault', async () => {
    switchTo.mockResolvedValue({ success: true, data: 'usable' })

    await switchToOther()

    await waitFor(() => expect(useVaultStore.getState().status).toBe('locked'))
    const s = useVaultStore.getState()
    expect(switchTo).toHaveBeenCalledExactlyOnceWith(OTHER)
    expect(s.notes).toEqual([])
    expect(s.tags).toEqual([])
    expect(s.tagCounts).toEqual({})
    expect(s.noteTagsMap).toEqual({})
    expect(s.activeNoteId).toBeNull()
    // recentVaults[0] is still the old vault, so Unlock must not fall back to it
    expect(s.pendingOpenVaultPath).toBe(OTHER)
  })

  it('labels a recent vault that can not be opened as part of its name', async () => {
    hasVault.mockImplementation(async (path: string) => ({
      success: true,
      data: path === OTHER ? 'missing' : 'usable'
    }))
    render(createElement(VaultSwitcher), { wrapper: TooltipProvider })

    fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })

    const other = await screen.findByRole('menuitem', { name: /home\.nvx.*Not found/ })
    expect(other).toBeTruthy()
    expect(hasVault).toHaveBeenCalledWith(OTHER)
    expect(screen.getByRole('menuitem', { name: /work\.nvx/ }).textContent).not.toMatch(/Not found/)
  })

  it('choosing a vault that can not be opened says why and keeps the session', async () => {
    hasVault.mockImplementation(async (path: string) => ({
      success: true,
      data: path === OTHER ? 'missing' : 'usable'
    }))
    render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
    fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })

    fireEvent.click(await screen.findByRole('menuitem', { name: /home\.nvx.*Not found/ }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith("Couldn't find this vault", {
        description: `home.nvx isn't at ${OTHER}. It may have been moved, renamed or be on a disconnected drive.`
      })
    )
    expect(switchTo).not.toHaveBeenCalled()
    const s = useVaultStore.getState()
    expect(s.status).toBe('unlocked')
    expect(s.notes).toEqual([note])
  })

  it('the x on a recent vault removes it from the list and keeps the menu open', async () => {
    await openMenuWithOtherMissing()

    const x = screen.getByRole('button', { name: /Remove .*home\.nvx from recent vaults/ })
    expect(x.getAttribute('tabindex')).toBe('-1')
    fireEvent.click(x)

    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /home\.nvx/ })).toBeNull())
    expect(removeRecentVault).toHaveBeenCalledExactlyOnceWith(OTHER)
    expect(screen.getByRole('menuitem', { name: /Lock vault/ })).toBeTruthy()
    expect(switchTo).not.toHaveBeenCalled()
    expect(useVaultStore.getState().status).toBe('unlocked')
  })

  it('Delete on a focused recent vault removes it and announces the shortcut', async () => {
    await openMenuWithOtherMissing()

    const item = screen.getByRole('menuitem', { name: /home\.nvx/ })
    expect(item.getAttribute('aria-keyshortcuts')).toBe('Delete')
    fireEvent.keyDown(item, { key: 'Delete' })

    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /home\.nvx/ })).toBeNull())
    expect(removeRecentVault).toHaveBeenCalledExactlyOnceWith(OTHER)
    expect(screen.getByRole('menuitem', { name: /Lock vault/ })).toBeTruthy()
    expect(switchTo).not.toHaveBeenCalled()
  })

  it('the open vault has no x and Delete on it does nothing', async () => {
    await openMenuWithOtherMissing()

    const current = screen.getByRole('menuitem', { name: /work\.nvx/ })
    expect(current.getAttribute('aria-keyshortcuts')).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove .*work\.nvx/ })).toBeNull()
    fireEvent.keyDown(current, { key: 'Delete' })

    expect(removeRecentVault).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: /work\.nvx/ })).toBeTruthy()
  })

  describe('focus after removing an entry', () => {
    const PLAY = 'C:/vaults/play.nvx'
    const entry = (path: string, i: number): RecentVault => ({
      path,
      hasKeyFile: false,
      lastOpenedAt: 3 - i
    })

    async function removeAndGetFocused(removed: string, name: RegExp): Promise<string> {
      const before = [CURRENT, OTHER, PLAY].map(entry)
      usePrefsStore.setState({ recentVaults: before })
      prefsGet.mockResolvedValue({ success: true, data: { recentVaults: before } })
      removeRecentVault.mockImplementation(async () => {
        const after = before.filter((v) => v.path !== removed)
        prefsGet.mockResolvedValue({ success: true, data: { recentVaults: after } })
        return { success: true, data: null }
      })
      render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
      fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })
      fireEvent.click(await screen.findByRole('button', { name }))
      await waitFor(() => expect(removeRecentVault).toHaveBeenCalled())
      await waitFor(() =>
        expect(screen.getAllByRole('menuitem', { name: /\.nvx/ })).toHaveLength(2)
      )
      const spy = vi.mocked(HTMLElement.prototype.focus)
      const items = spy.mock.contexts.filter(
        (el) => (el as HTMLElement).getAttribute('role') === 'menuitem'
      ) as HTMLElement[]
      return items.at(-1)?.textContent ?? 'nothing focused'
    }

    it('moves to the entry that follows', async () => {
      expect(await removeAndGetFocused(OTHER, /Remove .*home\.nvx/)).toMatch(/play\.nvx/)
    })

    it('moves to the previous entry when the last one is removed', async () => {
      expect(await removeAndGetFocused(PLAY, /Remove .*play\.nvx/)).toMatch(/home\.nvx/)
    })
  })

  it('a switch that finds the file gone says why and keeps the session', async () => {
    switchTo.mockResolvedValue({ success: true, data: 'missing' })

    await switchToOther()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith("Couldn't find this vault", {
        description: `home.nvx isn't at ${OTHER}. It may have been moved, renamed or be on a disconnected drive.`
      })
    )
    const s = useVaultStore.getState()
    expect(s.status).toBe('unlocked')
    expect(s.notes).toEqual([note])
    expect(s.pendingOpenVaultPath).toBeNull()
  })

  it('a rejected switch keeps the session and says why', async () => {
    switchTo.mockResolvedValue({ success: false, error: 'Vault not found.' })

    await switchToOther()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Vault not found.'))
    const s = useVaultStore.getState()
    expect(s.status).toBe('unlocked')
    expect(s.notes).toEqual([note])
    expect(s.pendingOpenVaultPath).toBeNull()
  })
})
