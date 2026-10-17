// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem, Tag } from '@shared/types'

const close = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({ notvex: { vault: { close } } }))

import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

const tag: Tag = { id: 't1', name: 'secret-project', color: '#888888', createdAt: 0 }
const note: NoteListItem = {
  id: 'n1',
  title: 'Decrypted title',
  isPinned: false,
  isTrashed: false,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null,
  tags: [tag]
}

const fillSession = (): void => {
  useVaultStore.setState({
    status: 'unlocked',
    currentVaultPath: '/vaults/a.nvx',
    vaultVersion: { maj: 1, min: 0 },
    notes: [note],
    tags: [tag],
    tagCounts: { t1: 1 },
    noteTagsMap: { n1: ['t1'] },
    activeNoteId: 'n1',
    needsRecoveryReset: true
  })
  useUiStore.setState({
    activeTags: ['t1'],
    searchQuery: 'secret',
    showTrash: true,
    showPinned: true,
    editorMode: 'reading'
  })
}

const expectCleared = (): void => {
  const v = useVaultStore.getState()
  expect(v.notes).toEqual([])
  expect(v.tags).toEqual([])
  expect(v.tagCounts).toEqual({})
  expect(v.noteTagsMap).toEqual({})
  expect(v.activeNoteId).toBeNull()
  expect(v.status).toBe('locked')
  expect(v.currentVaultPath).toBeNull()
  expect(v.vaultVersion).toBeNull()
  expect(v.needsRecoveryReset).toBe(false)

  const ui = useUiStore.getState()
  expect(ui.activeTags).toEqual([])
  expect(ui.searchQuery).toBe('')
  expect(ui.showTrash).toBe(false)
  expect(ui.showPinned).toBe(false)
}

beforeEach(() => {
  close.mockReset()
  fillSession()
})

describe('clearSession', () => {
  it('drops every piece of decrypted vault state and the filters built on it', () => {
    useVaultStore.getState().clearSession()
    expectCleared()
  })

  it('leaves view preferences that carry no vault content', () => {
    useVaultStore.getState().clearSession()
    expect(useUiStore.getState().editorMode).toBe('reading')
  })

  it('does not touch main: the caller is reacting to a close main already did', () => {
    useVaultStore.getState().clearSession()
    expect(close).not.toHaveBeenCalled()
  })
})

describe('lock', () => {
  it('closes the vault in main, then clears', async () => {
    close.mockImplementation(async () => {
      expect(useVaultStore.getState().notes).toHaveLength(1)
      return { success: true, data: null }
    })
    await useVaultStore.getState().lock()
    expect(close).toHaveBeenCalledOnce()
    expectCleared()
  })

  it('clears even when main reports the close failed', async () => {
    close.mockResolvedValue({ success: false, error: 'boom' })
    await useVaultStore.getState().lock()
    expectCleared()
  })

  it('clears even when the close call throws', async () => {
    close.mockRejectedValue(new Error('ipc gone'))
    await expect(useVaultStore.getState().lock()).rejects.toThrow('ipc gone')
    expectCleared()
  })
})
