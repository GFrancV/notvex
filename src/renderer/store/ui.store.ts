import { create } from 'zustand'

interface UiStore {
  showPreview: boolean
  searchQuery: string
  activeTagFilter: string | null
  showTrash: boolean
  commandPaletteOpen: boolean
  settingsOpen: boolean
  setShowPreview: (v: boolean) => void
  togglePreview: () => void
  setSearchQuery: (q: string) => void
  setActiveTagFilter: (id: string | null) => void
  setShowTrash: (v: boolean) => void
  setCommandPaletteOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
}

function loadLS(key: string, fallback: boolean): boolean {
  try { return JSON.parse(localStorage.getItem(key) ?? '') }
  catch { return fallback }
}

export const useUiStore = create<UiStore>((set) => ({
  showPreview: loadLS('notvex.showPreview', false),
  searchQuery: '',
  activeTagFilter: null,
  showTrash: false,
  commandPaletteOpen: false,
  settingsOpen: false,

  setShowPreview: (showPreview) => {
    set({ showPreview })
    localStorage.setItem('notvex.showPreview', JSON.stringify(showPreview))
  },
  togglePreview: () =>
    set((s) => {
      const next = !s.showPreview
      localStorage.setItem('notvex.showPreview', JSON.stringify(next))
      return { showPreview: next }
    }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveTagFilter: (activeTagFilter) => set({ activeTagFilter, showTrash: false }),
  setShowTrash: (showTrash) => set({ showTrash, activeTagFilter: null }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}))
