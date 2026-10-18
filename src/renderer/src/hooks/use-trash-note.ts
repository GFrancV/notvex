import { useCallback } from 'react'

import { notvex } from '@/lib/ipc'
import { ipcSucceeded } from '@/lib/ipc-succeeded'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

/** Resolves `true` only once main has moved the note to the trash. */
export function useTrashNote(): (id: string) => Promise<boolean> {
  const { loadNotes, loadTagCounts, setActiveNoteId } = useVaultStore()

  return useCallback(
    async (id) => {
      if (!(await ipcSucceeded(notvex.notes.trash(id), 'Failed to move note to trash'))) {
        return false
      }
      if (useVaultStore.getState().activeNoteId === id) setActiveNoteId(null)
      void loadNotes({ trashed: useUiStore.getState().showTrash })
      void loadTagCounts()
      return true
    },
    [loadNotes, loadTagCounts, setActiveNoteId]
  )
}
