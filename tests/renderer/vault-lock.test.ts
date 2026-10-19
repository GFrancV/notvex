// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteListItem, Tag } from '@shared/types'

const close = vi.hoisted(() => vi.fn())

// Every tag IPC call hangs until the test replies, so the test controls what lands first
const ipc = vi.hoisted(() => {
  let settle: (res: unknown) => void = () => {}
  const pending = (): Promise<unknown> =>
    new Promise((resolve) => {
      settle = resolve
    })
  return { pending, reply: (res: unknown): void => settle(res) }
})

vi.mock('@/lib/ipc', () => ({
  notvex: {
    vault: { close },
    tags: { createAndAssign: ipc.pending, update: ipc.pending, delete: ipc.pending },
    noteTags: { add: ipc.pending, remove: ipc.pending }
  }
}))

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

const tagActions: [string, () => Promise<unknown>][] = [
  [
    'createTagAndAssign',
    () => useVaultStore.getState().createTagAndAssign('n1', { name: 'new', color: '#888888' })
  ],
  ['updateTag', () => useVaultStore.getState().updateTag('t1', { name: 'renamed' })],
  ['deleteTag', () => useVaultStore.getState().deleteTag('t1')],
  ['addTagToNote', () => useVaultStore.getState().addTagToNote('n1', 't2')],
  ['removeTagFromNote', () => useVaultStore.getState().removeTagFromNote('n1', 't1')]
]

const vaultData = (): object => {
  const { notes, tags, tagCounts, noteTagsMap } = useVaultStore.getState()
  return { notes, tags, tagCounts, noteTagsMap }
}

describe('optimistic tag actions', () => {
  it.each(tagActions)('%s does not roll back into a session that has ended', async (_, run) => {
    const action = run()
    useVaultStore.getState().clearSession()
    ipc.reply({ success: false, error: 'vault closed' })
    await expect(action).rejects.toThrow('vault closed')
    expectCleared()
  })

  it.each(tagActions)(
    '%s does not roll back into a session reopened after the lock',
    async (_, run) => {
      const action = run()
      useVaultStore.getState().clearSession()
      const other: Tag = { id: 'o1', name: 'other-vault', color: '#888888', createdAt: 0 }
      useVaultStore.setState({
        status: 'unlocked',
        notes: [],
        tags: [other],
        tagCounts: { o1: 0 },
        noteTagsMap: {}
      })
      const reopened = vaultData()
      ipc.reply({ success: false, error: 'vault closed' })
      await expect(action).rejects.toThrow('vault closed')
      expect(vaultData()).toEqual(reopened)
    }
  )

  it.each(tagActions)('%s still rolls back while the session is live', async (_, run) => {
    const before = vaultData()
    const action = run()
    ipc.reply({ success: false, error: 'boom' })
    await expect(action).rejects.toThrow('boom')
    expect(vaultData()).toEqual(before)
  })

  it('createTagAndAssign writes nothing when it succeeds after the session ended', async () => {
    const action = useVaultStore
      .getState()
      .createTagAndAssign('n1', { name: 'new', color: '#888888' })
    useVaultStore.getState().clearSession()
    ipc.reply({ success: true, data: { ...tag, id: 't9', name: 'new' } })
    await action
    expectCleared()
  })
})
