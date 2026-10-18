import { useCallback } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

/** Resolves `true` only once main has saved the new pin state. */
export function useTogglePin(): (note: { id: string; isPinned: boolean }) => Promise<boolean> {
  const { loadNotes } = useVaultStore()

  return useCallback(
    async (note) => {
      const res = await notvex.notes
        .update(note.id, { isPinned: !note.isPinned })
        .catch(() => ({ success: false as const, error: 'Failed to update note' }))
      if (!res.success) {
        toast.error(res.error)
        return false
      }
      void loadNotes({ trashed: useUiStore.getState().showTrash })
      return true
    },
    [loadNotes]
  )
}
