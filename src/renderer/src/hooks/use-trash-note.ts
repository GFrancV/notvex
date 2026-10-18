import { useCallback } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

/** Resolves `true` only once main has moved the note to the trash. */
export function useTrashNote(): (id: string) => Promise<boolean> {
  const { loadNotes, loadTagCounts, setActiveNoteId } = useVaultStore()

  return useCallback(
    async (id) => {
      const res = await notvex.notes
        .trash(id)
        .catch(() => ({ success: false as const, error: 'Failed to move note to trash' }))
      if (!res.success) {
        toast.error(res.error)
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
