import { create } from 'zustand'

interface UiStore {
  editorMode: 'editing' | 'reading'
  searchQuery: string
  activeTags: string[]
  showTrash: boolean
  commandPaletteOpen: boolean
  settingsOpen: boolean
  tagSelectorNoteId: string | null
  removeTagNoteId: string | null
  setEditorMode: (mode: 'editing' | 'reading') => void
  toggleEditorMode: () => void
  setSearchQuery: (q: string) => void
  toggleActiveTag: (id: string, multi: boolean) => void
  clearActiveTags: () => void
  setShowTrash: (v: boolean) => void
  setCommandPaletteOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setTagSelectorNoteId: (id: string | null) => void
  setRemoveTagNoteId: (id: string | null) => void
}

export const useUiStore = create<UiStore>((set) => ({
  editorMode: 'editing',
  searchQuery: '',
  activeTags: [],
  showTrash: false,
  commandPaletteOpen: false,
  settingsOpen: false,
  tagSelectorNoteId: null,
  removeTagNoteId: null,

  setEditorMode: (editorMode): void => set({ editorMode }),
  toggleEditorMode: (): void =>
    set((s) => ({ editorMode: s.editorMode === 'editing' ? 'reading' : 'editing' })),
  setSearchQuery: (searchQuery): void => set({ searchQuery }),
  toggleActiveTag: (id, multi): void =>
    set((s) => {
      const isActive = s.activeTags.includes(id)
      if (isActive && s.activeTags.length === 1) return { activeTags: [], showTrash: false }
      if (isActive) return { activeTags: s.activeTags.filter((t) => t !== id) }
      if (multi) return { activeTags: [...s.activeTags, id], showTrash: false }
      return { activeTags: [id], showTrash: false }
    }),
  clearActiveTags: (): void => set({ activeTags: [] }),
  setShowTrash: (showTrash): void => set({ showTrash, activeTags: [] }),
  setCommandPaletteOpen: (commandPaletteOpen): void => set({ commandPaletteOpen }),
  setSettingsOpen: (settingsOpen): void => set({ settingsOpen }),
  setTagSelectorNoteId: (tagSelectorNoteId): void => set({ tagSelectorNoteId }),
  setRemoveTagNoteId: (removeTagNoteId): void => set({ removeTagNoteId })
}))
