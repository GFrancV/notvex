import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { CommandPalette } from '@/components/command-palette'
import { NoteEditor } from '@/components/note-editor'
import { NoteList } from '@/components/note-list'
import { Sidebar } from '@/components/sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useCreateNote } from '@/hooks/use-create-note'
import { notvex } from '@/lib/ipc'
import { flushAllPending } from '@/lib/pending-save'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

export function Main(): ReactNode {
  const { refreshAll, setActiveNoteId, setStatus, setNotes } = useVaultStore()
  const { setShowTrash, toggleEditorMode, requestFocusSearch } = useUiStore()
  const handleNewNote = useCreateNote()

  // Load initial data
  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  // Persist pending autosaves before the main process closes the vault
  useEffect(() => {
    return notvex.onWillLock(() => flushAllPending())
  }, [])

  // Listen for auto-lock events from main process
  useEffect(() => {
    const unsubscribe = notvex.onAutoLocked(() => {
      setStatus('locked')
      setActiveNoteId(null)
      setNotes([])
    })
    return unsubscribe
  }, [setStatus, setActiveNoteId, setNotes])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return

      if (e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'f':
            e.preventDefault()
            requestFocusSearch()
            return
          case 't':
            e.preventDefault()
            setShowTrash(true)
            return
          case 'e':
            e.preventDefault()
            toggleEditorMode()
            return
          default:
            break
        }
      }

      switch (e.key.toLowerCase()) {
        case 'l':
          e.preventDefault()
          void (async (): Promise<void> => {
            await notvex.vault.close()
            setStatus('locked')
            setActiveNoteId(null)
            setNotes([])
          })()
          break
        case 'n':
          e.preventDefault()
          void handleNewNote()
          break
        case 'k':
          // Handled by CommandPalette component itself
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return (): void => window.removeEventListener('keydown', handler)
  }, [
    handleNewNote,
    setStatus,
    setActiveNoteId,
    setNotes,
    toggleEditorMode,
    setShowTrash,
    requestFocusSearch
  ])

  return (
    <div className="bg-background flex h-screen flex-col overflow-hidden">
      <div className="titlebar-drag absolute top-0 right-0 left-0 h-11" />
      <SidebarProvider className="min-h-0! flex-1 overflow-hidden">
        <Sidebar />
        <SidebarInset className="flex min-w-0 flex-row">
          <NoteList />
          <NoteEditor />
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette />
    </div>
  )
}
