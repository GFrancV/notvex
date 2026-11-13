import { useCallback } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { showVaultFileProblem } from '@/lib/vault-file-problem'

interface UsePickVaultReturn {
  pickExistingVault: () => Promise<string | null>
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

  return { pickExistingVault }
}
