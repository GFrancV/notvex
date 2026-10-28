import { useCallback } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { ipcSucceeded } from '@/lib/ipc-succeeded'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import { useRestoreNote } from './use-restore-note'

/** Resolves `true` only once main has moved the note to the trash; offers Undo after it. */
export function useTrashNote(): (id: string) => Promise<boolean> {
  const { loadNotes, loadTagCounts, setActiveNoteId } = useVaultStore()
  const restoreNote = useRestoreNote()

  return useCallback(
    async (id) => {
      if (!(await ipcSucceeded(notvex.notes.trash(id), "Couldn't move the note to the trash"))) {
        return false
      }
      const wasOpen = useVaultStore.getState().activeNoteId === id
      if (wasOpen) setActiveNoteId(null)
      void loadNotes({ trashed: useUiStore.getState().showTrash })
      void loadTagCounts()

      const undo = async (): Promise<void> => {
        if (!(await restoreNote(id))) return
        // Reopen only if the user hasn't opened another note since.
        if (wasOpen && useVaultStore.getState().activeNoteId === null) setActiveNoteId(id)
      }
      toast('Moved to trash', { action: { label: 'Undo', onClick: () => void undo() } })
      return true
    },
    [loadNotes, loadTagCounts, restoreNote, setActiveNoteId]
  )
}
