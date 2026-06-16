import { create } from 'zustand'

import type { CreateNoteInput, CreateTagInput, NoteListItem, Tag, TagPatch } from '@shared/types'
import { notvex } from '../lib/ipc'

export type VaultStatus = 'checking' | 'uninitialized' | 'locked' | 'unlocked'

interface VaultStore {
  status: VaultStatus
  needsRecoveryReset: boolean
  pendingNewVaultPath: string | null
  notes: NoteListItem[]
  tags: Tag[]
  tagCounts: Record<string, number>
  noteTagsMap: Record<string, string[]>
  activeNoteId: string | null
  setStatus: (s: VaultStatus) => void
  setNeedsRecoveryReset: (value: boolean) => void
  setPendingNewVaultPath: (path: string | null) => void
  setNotes: (notes: NoteListItem[]) => void
  setTags: (tags: Tag[]) => void
  setTagCounts: (counts: Record<string, number>) => void
  setNoteTagsMap: (map: Record<string, string[]>) => void
  setActiveNoteId: (id: string | null) => void
  loadNotes: (filter?: { trashed?: boolean; tagId?: string }) => Promise<void>
  createNote: (input?: CreateNoteInput) => Promise<NoteListItem>
  loadTags: () => Promise<void>
  loadTagCounts: () => Promise<void>
  loadNoteTagsMap: () => Promise<void>
  refreshAll: () => Promise<void>
  createTag: (input: CreateTagInput) => Promise<Tag>
  updateTag: (id: string, patch: TagPatch) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  addTagToNote: (noteId: string, tagId: string) => Promise<void>
  removeTagFromNote: (noteId: string, tagId: string) => Promise<void>
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  status: 'checking',
  needsRecoveryReset: false,
  pendingNewVaultPath: null,
  notes: [],
  tags: [],
  tagCounts: {},
  noteTagsMap: {},
  activeNoteId: null,

  setStatus: (status): void => set({ status }),
  setNeedsRecoveryReset: (needsRecoveryReset): void => set({ needsRecoveryReset }),
  setPendingNewVaultPath: (pendingNewVaultPath): void => set({ pendingNewVaultPath }),
  setNotes: (notes): void => set({ notes }),
  setTags: (tags): void => set({ tags }),
  setTagCounts: (tagCounts): void => set({ tagCounts }),
  setNoteTagsMap: (noteTagsMap): void => set({ noteTagsMap }),
  setActiveNoteId: (activeNoteId): void => set({ activeNoteId }),

  loadNotes: async (filter = {}): Promise<void> => {
    const res = await notvex.notes.list(filter)
    if (res.success) set({ notes: res.data })
  },

  createNote: async (input?: CreateNoteInput): Promise<NoteListItem> => {
    const res = await notvex.notes.create(input ?? { title: 'Untitled', content: '' })
    if (!res.success) {
      throw new Error(res.error)
    }

    set((s) => ({ notes: [res.data, ...s.notes] }))

    return res.data
  },

  loadTags: async (): Promise<void> => {
    const res = await notvex.tags.list()
    if (res.success) set({ tags: res.data })
  },

  loadTagCounts: async (): Promise<void> => {
    const res = await notvex.noteTags.counts()
    if (res.success) set({ tagCounts: res.data })
  },

  loadNoteTagsMap: async (): Promise<void> => {
    const res = await notvex.noteTags.all()
    if (res.success) {
      const map: Record<string, string[]> = {}
      for (const { noteId, tagId } of res.data) {
        if (!map[noteId]) map[noteId] = []
        map[noteId].push(tagId)
      }
      set({ noteTagsMap: map })
    }
  },

  refreshAll: async (): Promise<void> => {
    const { loadNotes, loadTags, loadTagCounts, loadNoteTagsMap } = get()
    await Promise.all([loadNotes(), loadTags(), loadTagCounts(), loadNoteTagsMap()])
  },

  createTag: async (input): Promise<Tag> => {
    const tempId = `temp-${Date.now()}`
    const optimistic: Tag = {
      id: tempId,
      name: input.name,
      color: input.color,
      createdAt: Date.now()
    }
    set((s) => ({ tags: [...s.tags, optimistic] }))
    const res = await notvex.tags.create(input)
    if (!res.success) {
      set((s) => ({ tags: s.tags.filter((t) => t.id !== tempId) }))
      throw new Error(res.error)
    }
    set((s) => ({ tags: s.tags.map((t) => (t.id === tempId ? res.data : t)) }))
    return res.data
  },

  updateTag: async (id, patch): Promise<void> => {
    const prev = get().tags
    set((s) => ({ tags: s.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    const res = await notvex.tags.update(id, patch)
    if (!res.success) {
      set({ tags: prev })
      throw new Error(res.error)
    }
  },

  deleteTag: async (id): Promise<void> => {
    const prevTags = get().tags
    const prevMap = get().noteTagsMap
    const prevCounts = get().tagCounts
    const newMap = Object.fromEntries(
      Object.entries(prevMap).map(([nId, tIds]) => [nId, tIds.filter((t) => t !== id)])
    )
    set((s) => ({
      tags: s.tags.filter((t) => t.id !== id),
      noteTagsMap: newMap,
      tagCounts: Object.fromEntries(Object.entries(prevCounts).filter(([k]) => k !== id))
    }))
    const res = await notvex.tags.delete(id)
    if (!res.success) {
      set({ tags: prevTags, noteTagsMap: prevMap, tagCounts: prevCounts })
      throw new Error(res.error)
    }
  },

  addTagToNote: async (noteId, tagId): Promise<void> => {
    const prevMap = get().noteTagsMap
    const prevCounts = get().tagCounts
    const prevNotes = get().notes
    const current = prevMap[noteId] ?? []
    if (current.includes(tagId)) return
    const tag = get().tags.find((t) => t.id === tagId)
    set((s) => ({
      noteTagsMap: { ...s.noteTagsMap, [noteId]: [...current, tagId] },
      tagCounts: { ...s.tagCounts, [tagId]: (s.tagCounts[tagId] ?? 0) + 1 },
      notes: tag
        ? s.notes.map((n) => (n.id === noteId ? { ...n, tags: [...n.tags, tag] } : n))
        : s.notes
    }))
    const res = await notvex.noteTags.add(noteId, tagId)
    if (!res.success) {
      set({ noteTagsMap: prevMap, tagCounts: prevCounts, notes: prevNotes })
      throw new Error(res.error)
    }
  },

  removeTagFromNote: async (noteId, tagId): Promise<void> => {
    const prevMap = get().noteTagsMap
    const prevCounts = get().tagCounts
    const prevNotes = get().notes
    set((s) => ({
      noteTagsMap: {
        ...s.noteTagsMap,
        [noteId]: (s.noteTagsMap[noteId] ?? []).filter((t) => t !== tagId)
      },
      tagCounts: { ...s.tagCounts, [tagId]: Math.max(0, (s.tagCounts[tagId] ?? 1) - 1) },
      notes: s.notes.map((n) =>
        n.id === noteId ? { ...n, tags: n.tags.filter((t) => t.id !== tagId) } : n
      )
    }))
    const res = await notvex.noteTags.remove(noteId, tagId)
    if (!res.success) {
      set({ noteTagsMap: prevMap, tagCounts: prevCounts, notes: prevNotes })
      throw new Error(res.error)
    }
  }
}))
