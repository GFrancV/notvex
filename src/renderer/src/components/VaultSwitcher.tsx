import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  XIcon
} from 'lucide-react'
import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import {
  type VaultFileProblem,
  showVaultFileProblem,
  vaultFileProblem
} from '@/lib/vault-file-problem'
import { usePrefsStore } from '@/store/prefs.store'
import { useVaultStore } from '@/store/vault.store'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

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
  const { clearSession, setPendingOpenVaultPath, lock } = useVaultStore()
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath)

  const { load: loadPrefs } = usePrefsStore()
  const recentVaults = usePrefsStore((s) => s.recentVaults)

  const refresh = useCallback((): void => {
    loadPrefs()
  }, [loadPrefs])

  const [open, setOpen] = useState(false)
  const [problems, setProblems] = useState<Record<string, VaultFileProblem>>({})

  // Checked on open, and again when the list changes while open
  useEffect(() => {
    if (!open) return
    let stale = false
    void Promise.all(
      recentVaults.map(async ({ path }) => [path, await notvex.vault.hasVault(path)] as const)
    ).then((results) => {
      if (stale) return
      const found: Record<string, VaultFileProblem> = {}
      for (const [path, res] of results) {
        if (res.success && res.data !== 'usable') found[path] = res.data
      }
      setProblems(found)
    })
    return () => {
      stale = true
    }
  }, [open, recentVaults])

  const items = useRef(new Map<string, HTMLElement>())
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => {
    if (pendingFocus.current) items.current.get(pendingFocus.current)?.focus()
    pendingFocus.current = null
  }, [recentVaults])

  const handleOpenChange = (isOpen: boolean): void => {
    setOpen(isOpen)
    if (isOpen) refresh()
  }

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

  const handleRemove = async (path: string): Promise<void> => {
    const res = await notvex.prefs.removeRecentVault(path)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    // The focused entry is about to disappear: hand focus to the next one, or the previous if last
    const i = recentVaults.findIndex((v) => v.path === path)
    pendingFocus.current = (recentVaults[i + 1] ?? recentVaults[i - 1])?.path ?? null
    await loadPrefs()
  }

  const handleOpenOther = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('existing')
    if (!res.success || !res.data) return
    await handleSwitch(res.data)
  }

  const handleCreateNew = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('new')
    if (!res.success || !res.data) return
    await lock(res.data)
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9.5 w-full justify-start gap-2.25 rounded-none px-2.75"
        >
          <LockOpenIcon className="text-primary size-3.5 shrink-0" />
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-left text-xs">
            {currentVaultPath ? displayName(currentVaultPath) : 'Vault unlocked'}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={4} className="w-64">
        <DropdownMenuLabel>Recent vaults</DropdownMenuLabel>
        {recentVaults.map((vault) => {
          const isCurrent = isSamePath(currentVaultPath, vault.path)
          return (
            <Tooltip key={vault.path}>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  className={
                    isCurrent
                      ? 'text-foreground'
                      : 'group/item text-muted-foreground cursor-pointer'
                  }
                  ref={(el) => {
                    if (el) items.current.set(vault.path, el)
                    else items.current.delete(vault.path)
                  }}
                  aria-keyshortcuts={isCurrent ? undefined : 'Delete'}
                  onKeyDown={(e) => {
                    if (isCurrent || e.key !== 'Delete') return
                    e.preventDefault()
                    void handleRemove(vault.path)
                  }}
                  onSelect={() => {
                    if (isCurrent) return
                    const problem = problems[vault.path]
                    if (problem) showVaultFileProblem(problem, vault.path)
                    else void handleSwitch(vault.path)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{displayName(vault.path)}</span>
                  {problems[vault.path] && (
                    <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                      <AlertTriangleIcon className="text-warning size-3" aria-hidden />
                      {vaultFileProblem(problems[vault.path], vault.path).label}
                    </span>
                  )}
                  {isCurrent ? (
                    <CheckIcon className="text-primary ml-auto size-4 shrink-0" />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          tabIndex={-1}
                          aria-label={`Remove ${displayName(vault.path)} from recent vaults`}
                          className="shrink-0 opacity-0 group-hover/item:opacity-100"
                          onClick={(e) => {
                            // Keep the menu open and don't select the entry underneath
                            e.stopPropagation()
                            void handleRemove(vault.path)
                          }}
                        >
                          <XIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">Remove from recent vaults</TooltipContent>
                    </Tooltip>
                  )}
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="right">{vault.path}</TooltipContent>
            </Tooltip>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleOpenOther}>
          <FolderOpenIcon />
          Open vault…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleCreateNew}>
          <PlusIcon />
          Create new vault…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void lock()}>
          <LockIcon />
          Lock vault
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
