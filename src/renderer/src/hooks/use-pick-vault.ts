import { useCallback } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { vaultFolderAndName } from '@/lib/utils'
import { showVaultFileProblem } from '@/lib/vault-file-problem'

interface UsePickVaultReturn {
  pickExistingVault: () => Promise<string | null>
  // The vault is handed to onOpenExisting when the user picks "Open it" on the refusal toast
  pickNewVault: (onOpenExisting: (path: string) => void) => Promise<string | null>
}

export function usePickVault(): UsePickVaultReturn {
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
          description: vaultFolderAndName(path),
          duration: Infinity,
          closeButton: true,
          action: { label: 'Open it', onClick: () => onOpenExisting(path) }
        })
        return null
      }
      return path
    },
    []
  )

  return { pickExistingVault, pickNewVault }
}
