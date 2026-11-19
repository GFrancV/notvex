import { useCallback, useEffect } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { vaultFolderAndName } from '@/lib/utils'
import { showVaultFileProblem } from '@/lib/vault-file-problem'

// One refusal at a time, and it goes away with the screen that raised it: its "Open it" action
// points at that screen, and the toast never times out.
const ALREADY_A_VAULT_TOAST_ID = 'already-a-vault'

interface UsePickVaultReturn {
  pickExistingVault: () => Promise<string | null>
  // The vault is handed to onOpenExisting when the user picks "Open it" on the refusal toast
  pickNewVault: (onOpenExisting: (path: string) => void) => Promise<string | null>
  dismissRefusal: () => void
}

export function usePickVault(): UsePickVaultReturn {
  useEffect(() => () => void toast.dismiss(ALREADY_A_VAULT_TOAST_ID), [])

  const pickExistingVault = useCallback(async (): Promise<string | null> => {
    const chooseFileRes = await notvex.vault.chooseFile('existing')
    if (!chooseFileRes.success || !chooseFileRes.data) return null

    const hasVaultRes = await notvex.vault.hasVault(chooseFileRes.data)
    if (!hasVaultRes.success) {
      toast.error(hasVaultRes.error)
      return null
    }
    if (hasVaultRes.data !== 'usable') {
      showVaultFileProblem(hasVaultRes.data, chooseFileRes.data)
      return null
    }

    return chooseFileRes.data
  }, [])

  const pickNewVault = useCallback(
    async (onOpenExisting: (path: string) => void): Promise<string | null> => {
      const chooseFileRes = await notvex.vault.chooseFile('new')
      if (!chooseFileRes.success || !chooseFileRes.data) return null
      const path = chooseFileRes.data

      const hasVaultRes = await notvex.vault.hasVault(path)
      if (hasVaultRes.success && hasVaultRes.data === 'usable') {
        toast.error('That file is already a Notvex vault', {
          id: ALREADY_A_VAULT_TOAST_ID,
          description: vaultFolderAndName(path),
          duration: Infinity,
          closeButton: true,
          action: { label: 'Open it', onClick: () => onOpenExisting(path) }
        })
        return null
      }
      // A refusal left over from an earlier pick would offer to leave this one mid-create
      toast.dismiss(ALREADY_A_VAULT_TOAST_ID)
      return path
    },
    []
  )

  const dismissRefusal = useCallback(() => void toast.dismiss(ALREADY_A_VAULT_TOAST_ID), [])

  return { pickExistingVault, pickNewVault, dismissRefusal }
}
