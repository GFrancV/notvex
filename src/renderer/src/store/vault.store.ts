import { create } from 'zustand'

import type { NoteListItem, Tag } from '../../../shared/types'
import { notvex } from '../lib/ipc'

export type VaultStatus = 'checking' | 'uninitialized' | 'locked' | 'unlocked'

interface VaultStore {
  status: VaultStatus
  notes: NoteListItem[]
  tags: Tag[]
  tagCounts: Record<string, number>
  activeNoteId: string | null
  setStatus: (s: VaultStatus) => void
  setNotes: (notes: NoteListItem[]) => void
  setTags: (tags: Tag[]) => void
  setTagCounts: (counts: Record<string, number>) => void
  setActiveNoteId: (id: string | null) => void
  loadNotes: (filter?: { trashed?: boolean; tagId?: string }) => Promise<void>
  loadTags: () => Promise<void>
  loadTagCounts: () => Promise<void>
  refreshAll: () => Promise<void>
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  status: 'checking',
  notes: [],
  tags: [],
  tagCounts: {},
  activeNoteId: null,

  setStatus: (status): void => set({ status }),
  setNotes: (notes): void => set({ notes }),
  setTags: (tags): void => set({ tags }),
  setTagCounts: (tagCounts): void => set({ tagCounts }),
  setActiveNoteId: (activeNoteId): void => set({ activeNoteId }),

  loadNotes: async (filter = {}): Promise<void> => {
    const res = await notvex.notes.list(filter)
    if (res.success) set({ notes: res.data })
  },

  loadTags: async (): Promise<void> => {
    const res = await notvex.tags.list()
    if (res.success) set({ tags: res.data })
  },

  loadTagCounts: async (): Promise<void> => {
    const res = await notvex.noteTags.counts()
    if (res.success) set({ tagCounts: res.data })
  },

  refreshAll: async (): Promise<void> => {
    const { loadNotes, loadTags, loadTagCounts } = get()
    await Promise.all([loadNotes(), loadTags(), loadTagCounts()])
  }
}))
