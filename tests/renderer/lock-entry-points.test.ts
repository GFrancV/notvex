// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem, Tag } from '@shared/types'

// Main pushes these; the test fires them by hand.
const pushed = vi.hoisted(() => ({
  autoLocked: null as null | (() => void),
  openFile: null as null | ((path: string) => void)
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    platform: 'win32',
    prefs: { get: async () => ({ success: false, error: 'not needed' }) },
    vault: { getPendingFile: async () => ({ success: true, data: null }) },
    onAutoLocked: (cb: () => void) => {
      pushed.autoLocked = cb
      return () => {}
    },
    onOpenFile: (cb: (path: string) => void) => {
      pushed.openFile = cb
      return () => {}
    },
    onPackFailed: () => () => {}
  }
}))

// Only App's routing and listeners are under test, so every screen is a marker.
const view = (name: string) =>
  function View(): ReturnType<typeof createElement> {
    return createElement('p', null, name)
  }
vi.mock('@/views/main', () => ({ Main: view('main view') }))
vi.mock('@/views/unlock', () => ({ Unlock: view('unlock view') }))
vi.mock('@/views/setup', () => ({ Setup: view('setup view') }))
vi.mock('@/views/post-recovery-reset', () => ({ PostRecoveryReset: view('reset view') }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/dialogs/UpdateAvailableDialog', () => ({ UpdateAvailableDialog: () => null }))
vi.mock('@/components/dialogs/MigrationRequiredDialog', () => ({
  MigrationRequiredDialog: () => null
}))
vi.mock('@/components/dialogs/DevBuildWarningDialog', () => ({ DevBuildWarningDialog: () => null }))
vi.mock('@/components/dialogs/ReloadWindowDialog', () => ({ ReloadWindowDialog: () => null }))

const { default: App } = await import('@/App')
const { useVaultStore } = await import('@/store/vault.store')

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

// With no recent vaults, App's startup settles on 'uninitialized'; the session is seeded after.
const renderUnlockedApp = async (extra: { needsRecoveryReset?: boolean } = {}): Promise<void> => {
  render(createElement(App))
  await waitFor(() => expect(useVaultStore.getState().status).toBe('uninitialized'))
  act(() => {
    useVaultStore.setState({
      status: 'unlocked',
      currentVaultPath: 'C:/vaults/work.nvx',
      notes: [note],
      tags: [tag],
      tagCounts: { t1: 1 },
      noteTagsMap: { n1: ['t1'] },
      activeNoteId: 'n1',
      ...extra
    })
  })
}

const expectSessionCleared = (): void => {
  const s = useVaultStore.getState()
  expect(s.notes).toEqual([])
  expect(s.tags).toEqual([])
  expect(s.tagCounts).toEqual({})
  expect(s.noteTagsMap).toEqual({})
  expect(s.activeNoteId).toBeNull()
}

beforeEach(() => {
  pushed.autoLocked = null
  pushed.openFile = null
})

afterEach(() => {
  cleanup()
  useVaultStore.setState({
    pendingOpenVaultPath: null,
    pendingNewVaultPath: null,
    needsRecoveryReset: false
  })
})

describe('locks pushed by main', () => {
  it('an auto-lock clears the session even when PostRecoveryReset is showing', async () => {
    await renderUnlockedApp({ needsRecoveryReset: true })
    expect(screen.getByText('reset view')).toBeTruthy()

    act(() => pushed.autoLocked?.())

    expect(screen.getByText('unlock view')).toBeTruthy()
    expectSessionCleared()
    expect(useVaultStore.getState().needsRecoveryReset).toBe(false)
  })

  it('an auto-lock on a new vault still in Setup routes to Unlock', async () => {
    await renderUnlockedApp()
    act(() => useVaultStore.setState({ pendingNewVaultPath: 'C:/vaults/new.nvx' }))
    expect(screen.getByText('setup view')).toBeTruthy()

    act(() => pushed.autoLocked?.())

    expect(screen.getByText('unlock view')).toBeTruthy()
    expect(useVaultStore.getState().pendingNewVaultPath).toBeNull()
    // Prefs only reload when Setup finishes, so Unlock must be pointed at the created vault.
    expect(useVaultStore.getState().pendingOpenVaultPath).toBe('C:/vaults/new.nvx')
  })

  it('opening a .nvx while unlocked clears the session and queues the file', async () => {
    await renderUnlockedApp()
    expect(screen.getByText('main view')).toBeTruthy()

    act(() => pushed.openFile?.('C:/vaults/other.nvx'))

    expect(screen.getByText('unlock view')).toBeTruthy()
    expectSessionCleared()
    expect(useVaultStore.getState().pendingOpenVaultPath).toBe('C:/vaults/other.nvx')
  })
})
