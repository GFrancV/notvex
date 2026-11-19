// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem, RecentVault, Tag } from '@shared/types'

const switchTo = vi.hoisted(() => vi.fn())
const hasVault = vi.hoisted(() => vi.fn())
const prefsGet = vi.hoisted(() => vi.fn())
const removeRecentVault = vi.hoisted(() => vi.fn())
const chooseFile = vi.hoisted(() => vi.fn())
const close = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    prefs: { get: prefsGet, removeRecentVault },
    vault: { switchTo, hasVault, chooseFile, close }
  }
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }))

const { VaultSwitcher } = await import('@/components/VaultSwitcher')
const { usePrefsStore } = await import('@/store/prefs.store')
const { useVaultStore } = await import('@/store/vault.store')
const { toast } = await import('sonner')
const { TooltipProvider } = await import('@/components/ui/tooltip')

// Radix positions tooltips with ResizeObserver, which jsdom doesn't implement.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

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
      data: { recentVaults: [{ path: CURRENT, lastOpenedAt: 2 }] }
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
      { path: CURRENT, lastOpenedAt: 2 },
      { path: OTHER, lastOpenedAt: 1 }
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
    pendingNewVaultPath: null,
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

  it('on a case-sensitive platform, a vault whose path differs only in case is another vault', async () => {
    const twin = 'C:/vaults/Work.nvx'
    const { notvex } = await import('@/lib/ipc')
    Object.defineProperty(notvex, 'platform', { value: 'linux', configurable: true })
    try {
      usePrefsStore.setState({
        recentVaults: [
          { path: CURRENT, lastOpenedAt: 2 },
          { path: twin, lastOpenedAt: 1 }
        ]
      })
      render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
      fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })

      await screen.findByRole('menuitem', { name: /Work\.nvx/ })
      expect(screen.getByRole('button', { name: /Remove .*Work\.nvx/ })).toBeTruthy()
    } finally {
      Object.defineProperty(notvex, 'platform', { value: 'win32', configurable: true })
    }
  })

  it('the open vault keeps its check and is announced as the current vault', async () => {
    render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
    fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })

    const current = await screen.findByRole('menuitem', {
      name: 'vaults • work.nvx, current vault'
    })

    expect(current.querySelector('.lucide-check')).not.toBeNull()
    const other = screen.getByRole('menuitem', { name: /home\.nvx/ })
    expect(other.getAttribute('aria-label')).toBeNull()
    expect(other.querySelector('.lucide-check')).toBeNull()
  })

  it('shows each vault as folder • file and its full path on hover', async () => {
    render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
    const trigger = screen.getByRole('button', { name: /work\.nvx/ })
    expect(trigger.textContent).toBe('vaults • work.nvx')
    fireEvent.keyDown(trigger, { key: 'Enter' })

    const other = await screen.findByRole('menuitem', { name: /home\.nvx/ })
    expect(other.textContent).toContain('vaults • home.nvx')
    fireEvent.focus(other)

    expect((await screen.findByRole('tooltip')).textContent).toBe(OTHER)
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

  it('"Create new vault…" checks the chosen file, then locks and carries the new path', async () => {
    const NEW = 'C:/vaults/new.nvx'
    chooseFile.mockResolvedValue({ success: true, data: NEW })
    hasVault.mockImplementation(async (path: string) => ({
      success: true,
      data: path === NEW ? 'missing' : 'usable'
    }))
    close.mockResolvedValue({ success: true, data: null })
    render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
    fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })

    fireEvent.click(await screen.findByRole('menuitem', { name: /Create new vault…/ }))

    await waitFor(() => expect(useVaultStore.getState().status).toBe('locked'))
    expect(chooseFile).toHaveBeenCalledExactlyOnceWith('new')
    expect(hasVault).toHaveBeenCalledWith(NEW)
    expect(close).toHaveBeenCalledExactlyOnceWith(NEW)
    expect(useVaultStore.getState().pendingNewVaultPath).toBe(NEW)
  })

  it('"Create new vault…" on a file that is already a vault keeps the session and says so', async () => {
    chooseFile.mockResolvedValue({ success: true, data: OTHER })
    render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
    fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })

    fireEvent.click(await screen.findByRole('menuitem', { name: /Create new vault…/ }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        'That file is already a Notvex vault',
        expect.objectContaining({ description: 'vaults • home.nvx' })
      )
    )
    expect(close).not.toHaveBeenCalled()
    const s = useVaultStore.getState()
    expect(s.status).toBe('unlocked')
    expect(s.notes).toEqual([note])
    expect(s.pendingNewVaultPath).toBeNull()
  })

  it('"Open existing vault…" asks for a file and switches to it', async () => {
    const PICKED = 'C:/vaults/play.nvx'
    chooseFile.mockResolvedValue({ success: true, data: PICKED })
    switchTo.mockResolvedValue({ success: true, data: 'usable' })
    render(createElement(VaultSwitcher), { wrapper: TooltipProvider })
    fireEvent.keyDown(screen.getByRole('button', { name: /work\.nvx/ }), { key: 'Enter' })

    fireEvent.click(await screen.findByRole('menuitem', { name: /Open existing vault…/ }))

    await waitFor(() => expect(useVaultStore.getState().status).toBe('locked'))
    expect(chooseFile).toHaveBeenCalledExactlyOnceWith('existing')
    expect(switchTo).toHaveBeenCalledExactlyOnceWith(PICKED)
    expect(useVaultStore.getState().pendingOpenVaultPath).toBe(PICKED)
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
