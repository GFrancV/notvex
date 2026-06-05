import { create } from 'zustand'

interface UiStore {
  editorMode: 'editing' | 'reading'
  searchQuery: string
  activeTagFilter: string | null
  showTrash: boolean
  commandPaletteOpen: boolean
  settingsOpen: boolean
  setEditorMode: (mode: 'editing' | 'reading') => void
  toggleEditorMode: () => void
  setSearchQuery: (q: string) => void
  setActiveTagFilter: (id: string | null) => void
  setShowTrash: (v: boolean) => void
  setCommandPaletteOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
}

export const useUiStore = create<UiStore>((set) => ({
  editorMode: 'editing',
  searchQuery: '',
  activeTagFilter: null,
  showTrash: false,
  commandPaletteOpen: false,
  settingsOpen: false,

  setEditorMode: (editorMode): void => set({ editorMode }),
  toggleEditorMode: (): void =>
    set((s) => ({ editorMode: s.editorMode === 'editing' ? 'reading' : 'editing' })),
  setSearchQuery: (searchQuery): void => set({ searchQuery }),
  setActiveTagFilter: (activeTagFilter): void => set({ activeTagFilter, showTrash: false }),
  setShowTrash: (showTrash): void => set({ showTrash, activeTagFilter: null }),
  setCommandPaletteOpen: (commandPaletteOpen): void => set({ commandPaletteOpen }),
  setSettingsOpen: (settingsOpen): void => set({ settingsOpen }),
}))
