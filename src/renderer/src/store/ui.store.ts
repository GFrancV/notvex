import { create } from 'zustand'

interface UiStore {
  editorMode: 'editing' | 'reading'
  searchQuery: string
  activeTags: string[]
  showTrash: boolean
  showPinned: boolean
  commandPaletteOpen: boolean
  settingsOpen: boolean
  tagSelectorNoteId: string | null
  removeTagNoteId: string | null
  focusTitleRequest: number
  focusSearchRequest: number
  setEditorMode: (mode: 'editing' | 'reading') => void
  toggleEditorMode: () => void
  setSearchQuery: (q: string) => void
  toggleActiveTag: (id: string, multi: boolean) => void
  clearActiveTags: () => void
  setShowTrash: (v: boolean) => void
  setShowPinned: (v: boolean) => void
  setCommandPaletteOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setTagSelectorNoteId: (id: string | null) => void
  setRemoveTagNoteId: (id: string | null) => void
  requestFocusTitle: () => void
  requestFocusSearch: () => void
}

export const useUiStore = create<UiStore>((set) => ({
  editorMode: 'editing',
  searchQuery: '',
  activeTags: [],
  showTrash: false,
  showPinned: false,
  commandPaletteOpen: false,
  settingsOpen: false,
  tagSelectorNoteId: null,
  removeTagNoteId: null,
  focusTitleRequest: 0,
  focusSearchRequest: 0,

  setEditorMode: (editorMode): void => set({ editorMode }),
  toggleEditorMode: (): void =>
    set((s) => ({ editorMode: s.editorMode === 'editing' ? 'reading' : 'editing' })),
  setSearchQuery: (searchQuery): void => set({ searchQuery }),
  toggleActiveTag: (id, multi): void =>
    set((s) => {
      const isActive = s.activeTags.includes(id)
      if (isActive && s.activeTags.length === 1)
        return { activeTags: [], showTrash: false, showPinned: false }
      if (isActive) return { activeTags: s.activeTags.filter((t) => t !== id) }
      if (multi) return { activeTags: [...s.activeTags, id], showTrash: false, showPinned: false }
      return { activeTags: [id], showTrash: false, showPinned: false }
    }),
  clearActiveTags: (): void => set({ activeTags: [] }),
  setShowTrash: (showTrash): void => set({ showTrash, activeTags: [], showPinned: false }),
  setShowPinned: (showPinned): void => set({ showPinned, activeTags: [], showTrash: false }),
  setCommandPaletteOpen: (commandPaletteOpen): void => set({ commandPaletteOpen }),
  setSettingsOpen: (settingsOpen): void => set({ settingsOpen }),
  setTagSelectorNoteId: (tagSelectorNoteId): void => set({ tagSelectorNoteId }),
  setRemoveTagNoteId: (removeTagNoteId): void => set({ removeTagNoteId }),
  requestFocusTitle: (): void => set((s) => ({ focusTitleRequest: s.focusTitleRequest + 1 })),
  requestFocusSearch: (): void => set((s) => ({ focusSearchRequest: s.focusSearchRequest + 1 }))
}))
