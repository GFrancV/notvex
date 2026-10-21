import { useCallback } from 'react'

import { notvex } from '@/lib/ipc'
import { ipcSucceeded } from '@/lib/ipc-succeeded'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'

/** Resolves `true` only once main has saved the new pin state. */
export function useTogglePin(): (note: { id: string; isPinned: boolean }) => Promise<boolean> {
  const { loadNotes } = useVaultStore()

  return useCallback(
    async (note) => {
      const pinned = !note.isPinned
      const saved = await ipcSucceeded(
        notvex.notes.update(note.id, { isPinned: pinned }),
        'Failed to update note'
      )
      if (saved) {
        // The editor reads the pin from this entry; don't wait for the reload to show it.
        useVaultStore.setState((s) => ({
          notes: s.notes.map((n) => (n.id === note.id ? { ...n, isPinned: pinned } : n))
        }))
        void loadNotes({ trashed: useUiStore.getState().showTrash })
      }
      return saved
    },
    [loadNotes]
  )
}
