import { type ReactNode, useEffect, useRef, useState } from 'react'

import { AlertTriangleIcon, CheckIcon, FolderOpenIcon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { vaultFolderAndName } from '@/lib/utils'
import { type VaultFileProblem, vaultFileProblem } from '@/lib/vault-file-problem'
import { usePrefsStore } from '@/store/prefs.store'
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

// Case differences only matter on Windows, as in main's samePath
function isSamePath(a: string | null, b: string): boolean {
  if (a === null) return false
  return notvex.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

interface VaultMenuProps {
  trigger: ReactNode
  currentPath: string | null
  /** `problem` is why the vault can't be opened, when the check found one. */
  onSelect: (path: string, problem: VaultFileProblem | undefined) => void
  onOpenExisting: () => void
  onCreateNew: () => void
  /** Radix hands focus back to the trigger on close; the consumer can cancel that. */
  onCloseAutoFocus?: (event: Event) => void
  /** Extra items, after a separator below "Create new vault…". */
  children?: ReactNode
}

/** The known vaults plus open/create, shared by the unlocked vault menu and the Unlock screen. */
export function VaultMenu({
  trigger,
  currentPath,
  onSelect,
  onOpenExisting,
  onCreateNew,
  onCloseAutoFocus,
  children
}: VaultMenuProps): ReactNode {
  const { load: loadPrefs } = usePrefsStore()
  const recentVaults = usePrefsStore((s) => s.recentVaults)

  // The vault on screen may not be in recents (opened from a file, or from "Open existing vault…")
  const listed =
    currentPath && !recentVaults.some((v) => isSamePath(currentPath, v.path))
      ? [{ path: currentPath }, ...recentVaults]
      : recentVaults

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
    if (isOpen) void loadPrefs()
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

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={4}
        className="w-64"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DropdownMenuLabel>Recent vaults</DropdownMenuLabel>
        {listed.map((vault) => {
          const isCurrent = isSamePath(currentPath, vault.path)
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
                  aria-label={
                    isCurrent ? `${vaultFolderAndName(vault.path)}, current vault` : undefined
                  }
                  aria-keyshortcuts={isCurrent ? undefined : 'Delete'}
                  onKeyDown={(e) => {
                    if (isCurrent || e.key !== 'Delete') return
                    e.preventDefault()
                    void handleRemove(vault.path)
                  }}
                  onSelect={() => {
                    if (isCurrent) return
                    onSelect(vault.path, problems[vault.path])
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{vaultFolderAndName(vault.path)}</span>
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
                          aria-label={`Remove ${vaultFolderAndName(vault.path)} from recent vaults`}
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
        <DropdownMenuItem onSelect={onOpenExisting}>
          <FolderOpenIcon />
          Open existing vault…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCreateNew}>
          <PlusIcon />
          Create new vault…
        </DropdownMenuItem>
        {children && (
          <>
            <DropdownMenuSeparator />
            {children}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
