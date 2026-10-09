import { useCallback } from 'react'

import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

export function useCreateNote(): (title?: string) => Promise<void> {
  const { createNote, setActiveNoteId } = useVaultStore()
  const { searchQuery, setSearchQuery, requestFocusTitle } = useUiStore()

  return useCallback(
    async (title?: string) => {
      const trimmed = (title ?? searchQuery).trim()
      const note = await createNote(trimmed ? { title: trimmed, content: '' } : undefined)
      setActiveNoteId(note.id)
      setSearchQuery('')
      requestFocusTitle()
    },
    [createNote, setActiveNoteId, searchQuery, setSearchQuery, requestFocusTitle]
  )
}
