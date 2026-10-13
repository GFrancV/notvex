import { useCallback } from 'react'

import { toast } from 'sonner'

import { flushAllPending } from '@/lib/pending-save'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

export function useDuplicateNote(): (id: string) => Promise<void> {
  const { duplicateNote, setActiveNoteId } = useVaultStore()
  const { requestFocusTitle } = useUiStore()

  return useCallback(
    async (id: string) => {
      try {
        // Main copies what is on disk, so edits still inside the autosave debounce
        // must land first or the copy misses them.
        await flushAllPending()
        const copy = await duplicateNote(id)
        setActiveNoteId(copy.id)
        requestFocusTitle()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to duplicate note')
      }
    },
    [duplicateNote, setActiveNoteId, requestFocusTitle]
  )
}
