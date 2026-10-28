// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem, Tag } from '@shared/types'

const switchTo = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    // Failing keeps the seeded recentVaults, as when main couldn't promote the target
    prefs: { get: async () => ({ success: false, error: 'not needed' }) },
    vault: { switchTo }
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

beforeEach(() => {
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
    switchTo.mockResolvedValue({ success: true, data: null })

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
