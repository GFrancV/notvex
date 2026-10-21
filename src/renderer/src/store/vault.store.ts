import { create } from 'zustand'

import { notvex } from '@/lib/ipc'
import { useUiStore } from '@/store/ui.store'
import type {
  CreateNoteInput,
  CreateTagInput,
  NoteCounts,
  NoteListItem,
  Tag,
  TagPatch,
  VaultVersion
} from '@shared/types'

export type VaultStatus = 'checking' | 'uninitialized' | 'locked' | 'unlocked'

interface VaultStore {
  status: VaultStatus
  vaultVersion: VaultVersion | null
  currentVaultPath: string | null
  needsRecoveryReset: boolean
  pendingNewVaultPath: string | null
  pendingOpenVaultPath: string | null
  notes: NoteListItem[]
  noteCounts: NoteCounts
  tags: Tag[]
  tagCounts: Record<string, number>
  noteTagsMap: Record<string, string[]>
  activeNoteId: string | null
  setStatus: (s: VaultStatus) => void
  setVaultVersion: (v: VaultVersion | null) => void
  setCurrentVaultPath: (path: string | null) => void
  setNeedsRecoveryReset: (value: boolean) => void
  setPendingNewVaultPath: (path: string | null) => void
  setPendingOpenVaultPath: (path: string | null) => void
  setTags: (tags: Tag[]) => void
  setTagCounts: (counts: Record<string, number>) => void
  setNoteTagsMap: (map: Record<string, string[]>) => void
  setActiveNoteId: (id: string | null) => void
  /**
   * The one place that drops decrypted vault state. Call it directly when main has already
   * closed the vault (auto-lock, switch, open-file); otherwise call `lock()`. Any new piece of
   * vault-derived state must be cleared here.
   */
  clearSession: () => void
  lock: () => Promise<void>
  loadNotes: (filter?: { trashed?: boolean; tagId?: string }) => Promise<void>
  loadNoteCounts: () => Promise<void>
  createNote: (input?: CreateNoteInput) => Promise<NoteListItem>
  duplicateNote: (id: string) => Promise<NoteListItem>
  loadTags: () => Promise<void>
  loadTagCounts: () => Promise<void>
  loadNoteTagsMap: () => Promise<void>
  refreshAll: () => Promise<void>
  createTag: (input: CreateTagInput) => Promise<Tag>
  createTagAndAssign: (noteId: string, input: CreateTagInput) => Promise<Tag>
  updateTag: (id: string, patch: TagPatch) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  addTagToNote: (noteId: string, tagId: string) => Promise<void>
  removeTagFromNote: (noteId: string, tagId: string) => Promise<void>
}

// Bumped by clearSession. An optimistic action whose IPC reply lands after a lock must not
// write its snapshot back: status alone can't tell, a re-unlock may already have happened.
let session = 0

const NO_COUNTS: NoteCounts = { live: 0, pinned: 0, trashed: 0 }

export const useVaultStore = create<VaultStore>((set, get) => ({
  status: 'checking',
  vaultVersion: null,
  currentVaultPath: null,
  needsRecoveryReset: false,
  pendingNewVaultPath: null,
  pendingOpenVaultPath: null,
  notes: [],
  noteCounts: NO_COUNTS,
  tags: [],
  tagCounts: {},
  noteTagsMap: {},
  activeNoteId: null,

  setStatus: (status): void => {
    if (status === 'locked' || status === 'checking' || status === 'uninitialized') {
      set({ status, vaultVersion: null, currentVaultPath: null })
    } else {
      set({ status })
    }
  },
  setVaultVersion: (vaultVersion): void => set({ vaultVersion }),
  setCurrentVaultPath: (currentVaultPath): void => set({ currentVaultPath }),
  setNeedsRecoveryReset: (needsRecoveryReset): void => set({ needsRecoveryReset }),
  setPendingNewVaultPath: (pendingNewVaultPath): void => set({ pendingNewVaultPath }),
  setPendingOpenVaultPath: (pendingOpenVaultPath): void => set({ pendingOpenVaultPath }),
  setTags: (tags): void => set({ tags }),
  setTagCounts: (tagCounts): void => set({ tagCounts }),
  setNoteTagsMap: (noteTagsMap): void => set({ noteTagsMap }),
  setActiveNoteId: (activeNoteId): void => set({ activeNoteId }),

  clearSession: (): void => {
    session++
    set({
      notes: [],
      noteCounts: NO_COUNTS,
      activeNoteId: null,
      tags: [],
      tagCounts: {},
      noteTagsMap: {},
      needsRecoveryReset: false
    })
    get().setStatus('locked')
    useUiStore.getState().resetFilters()
  },

  lock: async (): Promise<void> => {
    // Clearing even when close fails is the fail-safe side: the worst case is a re-unlock
    try {
      await notvex.vault.close()
    } finally {
      get().clearSession()
    }
  },

  loadNotes: async (filter = {}): Promise<void> => {
    // List reloads follow note mutations, so the badges refresh with them.
    void get().loadNoteCounts()
    const res = await notvex.notes.list(filter)
    if (res.success) set({ notes: res.data })
  },

  loadNoteCounts: async (): Promise<void> => {
    const started = session
    const res = await notvex.notes.counts()
    if (res.success && session === started) set({ noteCounts: res.data })
  },

  createNote: async (input?: CreateNoteInput): Promise<NoteListItem> => {
    const res = await notvex.notes.create(input ?? { title: 'Untitled', content: '' })
    if (!res.success) {
      throw new Error(res.error)
    }

    set((s) => ({ notes: [res.data, ...s.notes] }))
    void get().loadNoteCounts()

    return res.data
  },

  duplicateNote: async (id: string): Promise<NoteListItem> => {
    const res = await notvex.notes.duplicate(id)
    if (!res.success) {
      throw new Error(res.error)
    }

    const copy = res.data
    set((s) => ({
      notes: [copy, ...s.notes],
      noteTagsMap: { ...s.noteTagsMap, [copy.id]: copy.tags.map((t) => t.id) }
    }))
    void get().loadNoteCounts()
    // The copy carries the source's tags, so every one of them gained a note.
    if (copy.tags.length > 0) void get().loadTagCounts()

    return copy
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

  createTagAndAssign: async (noteId, input): Promise<Tag> => {
    const tempId = `temp-${Date.now()}`
    const optimistic: Tag = {
      id: tempId,
      name: input.name,
      color: input.color,
      createdAt: Date.now()
    }
    const prevTags = get().tags
    const prevMap = get().noteTagsMap
    const prevCounts = get().tagCounts
    const prevNotes = get().notes
    const started = session

    set((s) => ({
      tags: [...s.tags, optimistic],
      noteTagsMap: { ...s.noteTagsMap, [noteId]: [...(s.noteTagsMap[noteId] ?? []), tempId] },
      tagCounts: { ...s.tagCounts, [tempId]: 1 },
      notes: s.notes.map((n) => (n.id === noteId ? { ...n, tags: [...n.tags, optimistic] } : n))
    }))

    const res = await notvex.tags.createAndAssign({ noteId, name: input.name, color: input.color })
    if (!res.success) {
      if (session === started) {
        set({ tags: prevTags, noteTagsMap: prevMap, tagCounts: prevCounts, notes: prevNotes })
      }
      throw new Error(res.error)
    }

    const realTag = res.data
    if (session !== started) return realTag
    set((s) => ({
      tags: s.tags.map((t) => (t.id === tempId ? realTag : t)),
      noteTagsMap: {
        ...s.noteTagsMap,
        [noteId]: (s.noteTagsMap[noteId] ?? []).map((id) => (id === tempId ? realTag.id : id))
      },
      tagCounts: {
        ...Object.fromEntries(Object.entries(s.tagCounts).filter(([k]) => k !== tempId)),
        [realTag.id]: 1
      },
      notes: s.notes.map((n) =>
        n.id === noteId ? { ...n, tags: n.tags.map((t) => (t.id === tempId ? realTag : t)) } : n
      )
    }))
    return realTag
  },

  updateTag: async (id, patch): Promise<void> => {
    const prev = get().tags
    const started = session
    set((s) => ({ tags: s.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    const res = await notvex.tags.update(id, patch)
    if (!res.success) {
      if (session === started) set({ tags: prev })
      throw new Error(res.error)
    }
  },

  deleteTag: async (id): Promise<void> => {
    const prevTags = get().tags
    const prevMap = get().noteTagsMap
    const prevCounts = get().tagCounts
    const started = session
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
      if (session === started) set({ tags: prevTags, noteTagsMap: prevMap, tagCounts: prevCounts })
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
    const started = session
    set((s) => ({
      noteTagsMap: { ...s.noteTagsMap, [noteId]: [...current, tagId] },
      tagCounts: { ...s.tagCounts, [tagId]: (s.tagCounts[tagId] ?? 0) + 1 },
      notes: tag
        ? s.notes.map((n) => (n.id === noteId ? { ...n, tags: [...n.tags, tag] } : n))
        : s.notes
    }))
    const res = await notvex.noteTags.add(noteId, tagId)
    if (!res.success) {
      if (session === started) {
        set({ noteTagsMap: prevMap, tagCounts: prevCounts, notes: prevNotes })
      }
      throw new Error(res.error)
    }
  },

  removeTagFromNote: async (noteId, tagId): Promise<void> => {
    const prevMap = get().noteTagsMap
    const prevCounts = get().tagCounts
    const prevNotes = get().notes
    const started = session
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
      if (session === started) {
        set({ noteTagsMap: prevMap, tagCounts: prevCounts, notes: prevNotes })
      }
      throw new Error(res.error)
    }
  }
}))
