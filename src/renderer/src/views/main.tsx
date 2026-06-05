import { useEffect } from 'react'

import { CommandPalette } from '../components/command-palette'
import { NoteEditor } from '../components/note-editor'
import { NoteList } from '../components/note-list'
import { Sidebar } from '../components/sidebar'
import { notvex } from '../lib/ipc'
import { useUiStore } from '../store/ui.store'
import { useVaultStore } from '../store/vault.store'

export function Main(): JSX.Element {
  const { refreshAll, setActiveNoteId, loadNotes, setStatus, setNotes } = useVaultStore()
  const { setShowTrash, toggleEditorMode } = useUiStore()

  // Load initial data
  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

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

      void (async (): Promise<void> => {
        switch (e.key.toLowerCase()) {
          case 'l':
            e.preventDefault()
            await notvex.vault.close()
            setStatus('locked')
            setActiveNoteId(null)
            setNotes([])
            break

          case 'n':
            e.preventDefault()
            {
              const res = await notvex.notes.create({ title: 'Untitled', content: '' })
              if (res.success) {
                await loadNotes()
                setActiveNoteId(res.data.id)
              }
            }
            break

          case 'k':
            // Handled by CommandPalette component itself
            break

          default:
            break
        }

        if (mod && e.shiftKey) {
          switch (e.key.toLowerCase()) {
            case 't':
              e.preventDefault()
              setShowTrash(true)
              break
            case 'e':
              e.preventDefault()
              toggleEditorMode()
              break
            default:
              break
          }
        }
      })()
    }

    window.addEventListener('keydown', handler)
    return (): void => window.removeEventListener('keydown', handler)
  }, [loadNotes, setStatus, setActiveNoteId, setNotes, toggleEditorMode, setShowTrash])

  return (
    <div className="bg-background pt-8.5">
      <div
        id="sidebar"
        className="bg-background fixed top-0 z-1000 flex h-8.5 w-full items-center justify-center border-b"
      >
        <span>Notvex</span>
      </div>
      <div style={{ height: 'calc(100vh - 2.125rem)' }} className="flex overflow-hidden">
        <Sidebar />
        <NoteList />
        <NoteEditor />
        <CommandPalette />
      </div>
    </div>
  )
}
