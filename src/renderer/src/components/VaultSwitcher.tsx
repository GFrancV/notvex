import type { ReactNode } from 'react'

import { ChevronsUpDownIcon, LockIcon, LockOpenIcon } from 'lucide-react'
import { toast } from 'sonner'

import { usePickVault } from '@/hooks/use-pick-vault'
import { notvex } from '@/lib/ipc'
import { vaultFolderAndName } from '@/lib/utils'
import { showVaultFileProblem } from '@/lib/vault-file-problem'
import { usePrefsStore } from '@/store/prefs.store'
import { useVaultStore } from '@/store/vault.store'
import { VaultMenu } from './VaultMenu'
import { Button } from './ui/button'
import { DropdownMenuItem } from './ui/dropdown-menu'

export function VaultSwitcher(): ReactNode {
  const { pickNewVault } = usePickVault()
  const { clearSession, setPendingOpenVaultPath, lock } = useVaultStore()
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath)

  const { load: loadPrefs } = usePrefsStore()

  const handleSwitch = async (path: string): Promise<void> => {
    const res = await notvex.vault.switchTo(path)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    // The file changed after the menu checked it; main left the session untouched
    if (res.data !== 'usable') {
      showVaultFileProblem(res.data, path)
      return
    }

    // Main already closed the vault and zeroed the master key, so the decrypted state goes first.
    // The pending path picks Unlock's target: recentVaults[0] can still be the old vault when main
    // couldn't promote this one in prefs.
    clearSession()
    setPendingOpenVaultPath(path)
    await loadPrefs()
  }

  const handleOpenOther = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('existing')
    if (!res.success || !res.data) return
    await handleSwitch(res.data)
  }

  const handleCreateNew = async (): Promise<void> => {
    const path = await pickNewVault((existing) => void handleSwitch(existing))
    if (path) await lock(path)
  }

  return (
    <VaultMenu
      trigger={
        <Button
          variant="ghost"
          className="h-9.5 w-full justify-start gap-2.25 rounded-none px-2.75"
        >
          <LockOpenIcon className="text-primary size-3.5 shrink-0" />
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-left text-xs">
            {currentVaultPath ? vaultFolderAndName(currentVaultPath) : 'Vault unlocked'}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground size-3 shrink-0" />
        </Button>
      }
      currentPath={currentVaultPath}
      onSelect={(path, problem) => {
        if (problem) showVaultFileProblem(problem, path)
        else void handleSwitch(path)
      }}
      onOpenExisting={() => void handleOpenOther()}
      onCreateNew={() => void handleCreateNew()}
    >
      <DropdownMenuItem onSelect={() => void lock()}>
        <LockIcon />
        Lock vault
      </DropdownMenuItem>
    </VaultMenu>
  )
}
