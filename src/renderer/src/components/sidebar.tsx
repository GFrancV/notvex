import React, { type JSX, useEffect, useState } from 'react'

import {
  FileTextIcon,
  MoreHorizontalIcon,
  PenIcon,
  PinIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon
} from 'lucide-react'

import { notvex } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import type { Tag } from '@shared/types'
import { ChangePasswordDialog } from './change-password-dialog'
import { SecuritySettingsDialog } from './security-settings-dialog'
import { TagCreateModal } from './tags/TagCreateModal'
import { TagDeleteModal } from './tags/TagDeleteModal'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'

export function Sidebar(): JSX.Element {
  const { tags, tagCounts, loadTags, loadTagCounts, notes, setStatus, setActiveNoteId, setNotes } =
    useVaultStore()
  const {
    activeTags,
    showTrash,
    showPinned,
    toggleActiveTag,
    clearActiveTags,
    setShowTrash,
    setShowPinned
  } = useUiStore()

  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [securitySettingsOpen, setSecuritySettingsOpen] = useState(false)
  const [autoLockMinutes, setAutoLockMinutes] = useState(15)
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null)

  useEffect(() => {
    void loadTags()
    void loadTagCounts()
    void notvex.prefs.get().then((res) => {
      if (res.success && res.data && typeof res.data === 'object') {
        const prefs = res.data as { autoLockMinutes?: number; vaultPath?: string | null }
        setAutoLockMinutes(prefs.autoLockMinutes ?? 15)
        setVaultPath(prefs.vaultPath ?? null)
      }
    })
  }, [loadTags, loadTagCounts])

  const handleLock = async (): Promise<void> => {
    await notvex.vault.close()
    setStatus('locked')
    setActiveNoteId(null)
    setNotes([])
  }

  const handleAutoLockChange = (minutes: number): void => {
    setAutoLockMinutes(minutes)
    void notvex.prefs.set('autoLockMinutes', minutes)
  }

  const allNotesCount = notes.filter((n) => !n.isTrashed).length
  const pinnedCount = notes.filter((n) => n.isPinned && !n.isTrashed).length
  const trashCount = notes.filter((n) => n.isTrashed).length

  return (
    <div className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-60 shrink-0 flex-col">
      {/* App header */}
      <div className="titlebar-drag flex items-center justify-between px-4 py-4">
        <span className="titlebar-no-drag text-sm font-semibold select-none">Notvex</span>
        <div className="titlebar-no-drag flex items-center gap-1">
          <Popover open={settingsPopoverOpen} onOpenChange={setSettingsPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                <SettingsIcon />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-4 p-4">
              <div>
                <p className="mb-3 text-sm font-medium">Settings</p>
              </div>
              <div className="space-y-2">
                <Label>Auto-lock after</Label>
                <select
                  value={autoLockMinutes}
                  onChange={(e) => handleAutoLockChange(Number(e.target.value))}
                  className="w-full rounded-md border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5 text-sm text-[#e5e5e5] focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={0}>Never</option>
                </select>
              </div>
              {vaultPath && (
                <div className="space-y-1">
                  <Label>Vault location</Label>
                  <p className="text-xs break-all text-[#737373]">{vaultPath}</p>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-xs font-medium tracking-wide text-[#737373] uppercase">
                  Security
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start px-2 text-xs text-[#a3a3a3] hover:text-[#e5e5e5]"
                  onClick={() => {
                    setChangePasswordOpen(true)
                    setSettingsPopoverOpen(false)
                  }}
                >
                  Change password
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start px-2 text-xs text-[#a3a3a3] hover:text-[#e5e5e5]"
                  onClick={() => {
                    setSecuritySettingsOpen(true)
                    setSettingsPopoverOpen(false)
                  }}
                >
                  Security settings…
                </Button>
              </div>
              <Separator />
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={(): void => {
                  void handleLock()
                }}
              >
                Lock vault
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Separator />

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <nav className="space-y-0.5 p-2">
          <NavItem
            icon={<FileTextIcon className="h-3.5 w-3.5" />}
            label="All Notes"
            count={allNotesCount}
            active={activeTags.length === 0 && !showTrash && !showPinned}
            onClick={() => {
              clearActiveTags()
              setShowTrash(false)
              setShowPinned(false)
            }}
          />
          <NavItem
            icon={<PinIcon className="h-3.5 w-3.5" />}
            label="Pinned"
            count={pinnedCount}
            active={showPinned}
            onClick={() => setShowPinned(true)}
          />
          <NavItem
            icon={<Trash2Icon className="h-3.5 w-3.5" />}
            label="Trash"
            count={trashCount}
            active={showTrash}
            onClick={() => setShowTrash(true)}
          />
        </nav>

        {/* Tags section */}
        <div className="px-2 py-1">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold tracking-wider uppercase">Tags</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreateModalKey((k) => k + 1)
                setCreateModalOpen(true)
              }}
              title="New tag"
              className="text-muted-foreground"
            >
              <PlusIcon className="size-3" />
            </Button>
          </div>
          {tags.length === 0 ? (
            <div className="px-2 py-1">
              <p className="text-muted-foreground text-xs">No tags yet</p>
              <p className="text-muted-foreground text-xs">Click + to create one</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {tags.map((tag) => (
                <TagItem
                  key={tag.id}
                  tag={tag}
                  count={tagCounts[tag.id] ?? 0}
                  active={activeTags.includes(tag.id)}
                  onClick={(e) => toggleActiveTag(tag.id, e.ctrlKey || e.metaKey)}
                  onEdit={() => setEditingTag(tag)}
                  onDelete={() => setDeletingTag(tag)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Status indicator */}
      <div className="flex items-center gap-2 border border-t px-4 py-3">
        <div className="bg-primary h-2 w-2 rounded-full" />
        <span className="text-muted-foreground text-xs">Vault unlocked</span>
      </div>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />

      <SecuritySettingsDialog
        open={securitySettingsOpen}
        onClose={() => setSecuritySettingsOpen(false)}
      />

      <TagCreateModal
        key={createModalKey}
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
      <TagCreateModal
        key={editingTag?.id ?? 'edit-none'}
        open={!!editingTag}
        editTag={editingTag}
        onClose={() => setEditingTag(null)}
      />
      <TagDeleteModal open={!!deletingTag} tag={deletingTag} onClose={() => setDeletingTag(null)} />
    </div>
  )
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-[#1e1e1e] text-[#e5e5e5]'
          : 'text-[#737373] hover:bg-[#1a1a1a] hover:text-[#a3a3a3]'
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {count > 0 && <span className="text-xs text-[#737373]">{count}</span>}
    </button>
  )
}

function TagItem({
  tag,
  count,
  active,
  onClick,
  onEdit,
  onDelete
}: {
  tag: Tag
  count: number
  active: boolean
  onClick: (e: React.MouseEvent) => void
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md py-1.5 pr-8 pl-2 text-xs transition-colors',
          active
            ? 'bg-[#1e1e1e] text-[#e5e5e5]'
            : 'text-[#737373] hover:bg-[#1a1a1a] hover:text-[#a3a3a3]'
        )}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
        <span className="flex-1 text-left">{tag.name}</span>
        {count > 0 && <span className="text-xs text-[#737373]">{count}</span>}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <MoreHorizontalIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onClick={onEdit}>
            <PenIcon className="size-4" />
            Edit tag
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon className="size-4" />
            Delete tag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
