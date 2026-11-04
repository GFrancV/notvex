import { useCallback } from 'react'

import { dropTypeahead, startTypeahead } from '@/lib/title-typeahead'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

export function useCreateNote(): (title?: string) => Promise<void> {
  const { createNote, setActiveNoteId } = useVaultStore()
  const { searchQuery, setSearchQuery, setShowTrash, requestFocusTitle } = useUiStore()

  return useCallback(
    async (title?: string) => {
      const trimmed = (title ?? searchQuery).trim()
      // The title input only exists after the create and load round trips.
      startTypeahead()
      const note = await createNote(trimmed ? { title: trimmed, content: '' } : undefined).catch(
        (e: unknown) => {
          dropTypeahead()
          throw e
        }
      )
      // A new note is live: from the trash, show it where it lives (Ctrl+N works in any view).
      if (useUiStore.getState().showTrash) setShowTrash(false)
      setActiveNoteId(note.id)
      setSearchQuery('')
      requestFocusTitle()
    },
    [createNote, setActiveNoteId, searchQuery, setSearchQuery, setShowTrash, requestFocusTitle]
  )
}
