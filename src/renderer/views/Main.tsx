import { useEffect } from 'react'
import { useVaultStore } from '../store/vault.store'
import { useUiStore } from '../store/ui.store'
import { notvex } from '../lib/ipc'
import { Sidebar } from '../components/Sidebar'
import { NoteList } from '../components/NoteList'
import { NoteEditor } from '../components/NoteEditor'
import { CommandPalette } from '../components/CommandPalette'

export function Main(): JSX.Element {
  const { refreshAll, setActiveNoteId, loadNotes, setStatus, setNotes } = useVaultStore()
  const { setShowTrash, togglePreview, setCommandPaletteOpen } = useUiStore()

  // Load initial data
  useEffect(() => {
    refreshAll()
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
    const handler = async (e: KeyboardEvent): Promise<void> => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return

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

        case 'p':
          e.preventDefault()
          togglePreview()
          break

        case 'k':
          // Handled by CommandPalette component itself
          break

        default:
          break
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        setShowTrash(true)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [loadNotes, setStatus, setActiveNoteId, setNotes, togglePreview, setShowTrash])

  return (
    <div className="flex h-screen overflow-hidden bg-[#111111]">
      <Sidebar />
      <NoteList />
      <NoteEditor />
      <CommandPalette />
    </div>
  )
}
