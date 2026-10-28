import { useCallback } from 'react'

import { notvex } from '@/lib/ipc'
import { ipcSucceeded } from '@/lib/ipc-succeeded'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

/** Resolves `true` only once main has taken the note out of the trash. */
export function useRestoreNote(): (id: string) => Promise<boolean> {
  const { loadNotes, loadTagCounts } = useVaultStore()

  return useCallback(
    async (id) => {
      if (!(await ipcSucceeded(notvex.notes.restore(id), "Couldn't restore the note"))) return false
      void loadNotes({ trashed: useUiStore.getState().showTrash })
      // Tag counts leave trashed notes out, so a restored note counts again.
      void loadTagCounts()
      return true
    },
    [loadNotes, loadTagCounts]
  )
}
