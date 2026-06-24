import { useCallback } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'

interface UsePickVaultReturn {
  pickExistingVault: () => Promise<string | null>
}

export function usePickVault(): UsePickVaultReturn {
  const pickExistingVault = useCallback(async (): Promise<string | null> => {
    const chooseFileRes = await notvex.vault.chooseFile('existing')
    if (!chooseFileRes.success || !chooseFileRes.data) return null

    const hasVaultRes = await notvex.vault.hasVault(chooseFileRes.data)
    if (!hasVaultRes.success || !hasVaultRes.data) {
      toast.error('This file is not a valid Notvex vault')
      return null
    }

    return chooseFileRes.data
  }, [])

  return { pickExistingVault }
}
