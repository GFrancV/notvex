import { useCallback } from 'react'

import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

export function useCreateNote(): () => Promise<void> {
  const createNote = useVaultStore((s) => s.createNote)
  const setActiveNoteId = useVaultStore((s) => s.setActiveNoteId)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const requestFocusTitle = useUiStore((s) => s.requestFocusTitle)

  return useCallback(async () => {
    const title = searchQuery.trim()
    const note = await createNote(title ? { title, content: '' } : undefined)
    setActiveNoteId(note.id)
    setSearchQuery('')
    requestFocusTitle()
  }, [createNote, setActiveNoteId, searchQuery, setSearchQuery, requestFocusTitle])
}
