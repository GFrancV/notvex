import { useCallback } from 'react'

import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

export function useCreateNote(): (title?: string) => Promise<void> {
  const { createNote, setActiveNoteId } = useVaultStore()
  const { searchQuery, setSearchQuery, requestFocusTitle } = useUiStore()

  return useCallback(
    async (title?: string) => {
      const t = (title ?? searchQuery).trim()
      const note = await createNote(t ? { title: t, content: '' } : undefined)
      setActiveNoteId(note.id)
      setSearchQuery('')
      requestFocusTitle()
    },
    [createNote, setActiveNoteId, searchQuery, setSearchQuery, requestFocusTitle]
  )
}
