import { useCallback } from 'react'

import { notvex } from '@/lib/ipc'
import { ipcSucceeded } from '@/lib/ipc-succeeded'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

/** Resolves `true` only once main has deleted the note for good. */
export function useDeleteNote(): (id: string) => Promise<boolean> {
  const { loadNotes, setActiveNoteId } = useVaultStore()

  return useCallback(
    async (id) => {
      if (!(await ipcSucceeded(notvex.notes.delete(id), "Couldn't delete the note"))) return false
      if (useVaultStore.getState().activeNoteId === id) setActiveNoteId(null)
      void loadNotes({ trashed: useUiStore.getState().showTrash })
      return true
    },
    [loadNotes, setActiveNoteId]
  )
}
