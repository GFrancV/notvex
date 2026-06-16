import { type ReactNode, useCallback, useEffect, useState } from 'react'

import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
  LockOpenIcon,
  PlusIcon
} from 'lucide-react'
import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { useVaultStore } from '@/store/vault.store'
import type { RecentVault } from '@shared/types'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

function displayName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  const name = segments[segments.length - 1] ?? path
  const parent = segments[segments.length - 2]
  return parent ? `${parent} • ${name}` : name
}

function isSamePath(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase()
}

export function VaultSwitcher(): ReactNode {
  const { setStatus, setActiveNoteId, setNotes, setPendingNewVaultPath } = useVaultStore()

  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentVault[]>([])

  const refresh = useCallback((): void => {
    void Promise.all([notvex.vault.status(), notvex.vault.recentVaults()]).then(
      ([statusRes, recentsRes]) => {
        if (statusRes.success) setCurrentPath(statusRes.data.vaultPath)
        if (recentsRes.success) setRecents(recentsRes.data)
      }
    )
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleOpenChange = (open: boolean): void => {
    if (open) refresh()
  }

  const handleSwitch = async (path: string): Promise<void> => {
    const res = await notvex.vault.switchTo(path)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    // Main process already closed the vault and zeroed the master key
    setActiveNoteId(null)
    setNotes([])
    setStatus('locked')
  }

  const handleOpenOther = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('existing')
    if (!res.success || !res.data) return
    await handleSwitch(res.data)
  }

  const handleCreateNew = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('new')
    if (!res.success || !res.data) return
    await notvex.vault.close()
    setActiveNoteId(null)
    setNotes([])
    setPendingNewVaultPath(res.data)
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9.5 w-full justify-start gap-2.25 rounded-none px-2.75"
        >
          <LockOpenIcon className="text-primary size-3.5 shrink-0" />
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-left text-xs">
            {currentPath ? displayName(currentPath) : 'Vault unlocked'}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={4} className="w-64">
        <TooltipProvider>
          <DropdownMenuLabel>Recent vaults</DropdownMenuLabel>
          {recents.map((vault) => {
            const isCurrent = isSamePath(currentPath, vault.path)
            return (
              <Tooltip key={vault.path}>
                <TooltipTrigger asChild>
                  <DropdownMenuItem
                    className={
                      isCurrent
                        ? 'text-foreground'
                        : vault.exists
                          ? undefined
                          : 'text-muted-foreground'
                    }
                    onSelect={() => {
                      if (!isCurrent) void handleSwitch(vault.path)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{displayName(vault.path)}</span>
                    {isCurrent && <CheckIcon className="text-primary ml-auto size-4 shrink-0" />}
                    {!vault.exists && (
                      <AlertTriangleIcon className="text-warning ml-auto size-3.5 shrink-0" />
                    )}
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="right">{vault.path}</TooltipContent>
              </Tooltip>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleOpenOther}>
            <FolderOpenIcon className="size-4" />
            Open vault...
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleCreateNew}>
            <PlusIcon className="size-4" />
            Create new vault...
          </DropdownMenuItem>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
