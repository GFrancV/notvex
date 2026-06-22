import { CURRENT_VERSION_MAJ } from '@shared/types'

import { useVaultStore } from '@/store/vault.store'

export interface VaultCapabilities {
  canUpgradeFormat: boolean
}

export function useVaultCapabilities(): VaultCapabilities {
  const vaultVersion = useVaultStore((s) => s.vaultVersion)
  return {
    canUpgradeFormat: vaultVersion !== null && vaultVersion.maj < CURRENT_VERSION_MAJ
  }
}
