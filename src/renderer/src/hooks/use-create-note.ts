import { useCallback } from 'react'

import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

export function useCreateNote(): () => Promise<void> {
  const { createNote, setActiveNoteId } = useVaultStore()
  const { searchQuery, setSearchQuery, requestFocusTitle } = useUiStore()

  return useCallback(async () => {
    const title = searchQuery.trim()
    const note = await createNote(title ? { title, content: '' } : undefined)
    setActiveNoteId(note.id)
    setSearchQuery('')
    requestFocusTitle()
  }, [createNote, setActiveNoteId, searchQuery, setSearchQuery, requestFocusTitle])
}
