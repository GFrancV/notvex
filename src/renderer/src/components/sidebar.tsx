import React, { useEffect, useRef, useState } from 'react'

import {
  ArrowBigUpIcon,
  CheckIcon,
  CommandIcon,
  CopyIcon,
  FileIcon,
  InfoIcon,
  LockIcon,
  MoreHorizontalIcon,
  PenIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  TrashIcon,
  XIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useCreateNote } from '@/hooks/use-create-note'
import { notvex } from '@/lib/ipc'
import { cn, truncatePath } from '@/lib/utils'
import { usePrefsStore } from '@/store/prefs.store'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import type { Tag } from '@shared/types'
import { AppLogo } from './AppLogo'
import { ChangePasswordDialog } from './change-password-dialog'
import { AppVersionDialog } from './dialogs/AppVersionDialog'
import { SecuritySettingsDialog } from './security-settings-dialog'
import { TagCreateModal } from './tags/TagCreateModal'
import { TagDeleteModal } from './tags/TagDeleteModal'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'
import { Kbd } from './ui/kbd'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator
} from './ui/sidebar'
import { VaultSwitcher } from './VaultSwitcher'

const handleSaveCopy = async (): Promise<void> => {
  const result = await notvex.vault.saveCopyAs()
  if (!result.success) {
    toast.error('Failed to save copy')
    return
  }

  if (result.data) toast.success('Copy saved successfully')
}

export function Sidebar(): React.ReactNode {
  const { loadTags, loadTagCounts, setStatus, setActiveNoteId, setNotes } = useVaultStore()
  const { tags, tagCounts, notes, currentVaultPath } = useVaultStore(
    useShallow((s) => ({
      tags: s.tags,
      tagCounts: s.tagCounts,
      notes: s.notes,
      currentVaultPath: s.currentVaultPath
    }))
  )

  const { toggleActiveTag, clearActiveTags, setShowTrash, setShowPinned, setSearchQuery } =
    useUiStore()
  const { activeTags, showTrash, showPinned, searchQuery, focusSearchRequest } = useUiStore(
    useShallow((s) => ({
      activeTags: s.activeTags,
      showTrash: s.showTrash,
      showPinned: s.showPinned,
      searchQuery: s.searchQuery,
      focusSearchRequest: s.focusSearchRequest
    }))
  )

  const { setPref } = usePrefsStore()
  const autoLockMinutes = usePrefsStore((s) => s.autoLockMinutes)

  const handleNewNote = useCreateNote()
  const { isCopied, copyToClipboard } = useCopyToClipboard()

  const searchContainerRef = useRef<HTMLDivElement>(null)
  const [appVersionOpen, setAppVersionOpen] = useState(false)
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [securitySettingsOpen, setSecuritySettingsOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null)

  useEffect(() => {
    if (focusSearchRequest === 0) return
    searchContainerRef.current?.querySelector('input')?.focus()
  }, [focusSearchRequest])

  useEffect(() => {
    void loadTags()
    void loadTagCounts()
  }, [loadTags, loadTagCounts])

  const handleLock = async (): Promise<void> => {
    await notvex.vault.close()
    setStatus('locked')
    setActiveNoteId(null)
    setNotes([])
  }

  const handleAutoLockChange = (minutes: string): void => {
    void setPref('autoLockMinutes', Number(minutes))
  }

  const allNotesCount = notes.filter((n) => !n.isTrashed).length
  const pinnedCount = notes.filter((n) => n.isPinned && !n.isTrashed).length
  const trashCount = notes.filter((n) => n.isTrashed).length

  const allNotesActive = activeTags.length === 0 && !showTrash && !showPinned

  return (
    <ShadcnSidebar collapsible="none" className="border-sidebar-border border-r">
      <SidebarHeader className="gap-0 p-0">
        {/* App header */}
        <div
          className={cn(
            'border-sidebar-border flex items-center justify-between border-b',
            notvex.platform === 'darwin' ? 'h-11 pr-3 pl-19' : 'h-10 pr-3 pl-4'
          )}
        >
          <span className="flex items-center gap-1.5 text-lg font-bold select-none">
            <AppLogo className="size-6 rounded" />
            Notvex
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              className="titlebar-no-drag z-50"
              onClick={() => {
                setAppVersionOpen(true)
              }}
            >
              <InfoIcon />
            </Button>
            <DropdownMenu open={settingsPopoverOpen} onOpenChange={setSettingsPopoverOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="xs" className="titlebar-no-drag z-50">
                  <SettingsIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" sideOffset={4} className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Auto-lock</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <Select value={String(autoLockMinutes)} onValueChange={handleAutoLockChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a lock-out time" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectGroup>
                          <SelectItem value="0">Never</SelectItem>
                          <SelectItem value="5">After 5 minutes</SelectItem>
                          <SelectItem value="15">After 15 minutes</SelectItem>
                          <SelectItem value="30">After 30 minutes</SelectItem>
                          <SelectItem value="60">After 1 hour</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                {currentVaultPath && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Vault Location</DropdownMenuLabel>
                      <DropdownMenuItem>
                        <InputGroup onClick={(e) => e.stopPropagation()}>
                          <InputGroupInput readOnly value={truncatePath(currentVaultPath, 28)} />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              onClick={() => copyToClipboard(currentVaultPath)}
                              title="Copy to Clipboard"
                            >
                              {isCopied ? <CheckIcon className="text-primary" /> : <CopyIcon />}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        role="button"
                        className="text-primary"
                        onClick={handleSaveCopy}
                      >
                        Save a vault copy as...
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Security</DropdownMenuLabel>
                  <DropdownMenuItem
                    role="button"
                    className="text-primary"
                    onClick={() => {
                      setChangePasswordOpen(true)
                      setSettingsPopoverOpen(false)
                    }}
                  >
                    Change password
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    role="button"
                    className="text-primary"
                    onClick={() => {
                      setSecuritySettingsOpen(true)
                      setSettingsPopoverOpen(false)
                    }}
                  >
                    Security settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={(): void => {
                      void handleLock()
                    }}
                    className="justify-center"
                  >
                    <LockIcon />
                    Lock vault
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Search + new note */}
        <div className="flex gap-1.5 px-3 py-2.5">
          <div ref={searchContainerRef} className="w-full">
            <InputGroup className="w-full">
              <InputGroupInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void handleNewNote()
                  }
                }}
                placeholder="Search ..."
              />
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupAddon align="inline-end">
                {searchQuery ? (
                  <Button variant="ghost" size="icon-xs" onClick={() => setSearchQuery('')}>
                    <XIcon />
                  </Button>
                ) : (
                  <Kbd>
                    {notvex.platform === 'darwin' ? <CommandIcon /> : 'Ctrl'} + <ArrowBigUpIcon /> +
                    F
                  </Kbd>
                )}
              </InputGroupAddon>
            </InputGroup>
          </div>

          {!showTrash && !showPinned && (
            <Button
              variant="secondary"
              size="icon"
              onClick={(): void => {
                void handleNewNote()
              }}
              title="New note (Ctrl+N)"
              className="text-muted-foreground shrink-0"
            >
              <PlusIcon className="size-4" />
            </Button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Nav items */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={allNotesActive}
                onClick={() => {
                  clearActiveTags()
                  setShowTrash(false)
                  setShowPinned(false)
                }}
              >
                <FileIcon />
                All Notes
              </SidebarMenuButton>
              {allNotesCount > 0 && <SidebarMenuBadge>{allNotesCount}</SidebarMenuBadge>}
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton isActive={showPinned} onClick={() => setShowPinned(true)}>
                <PinIcon />
                Pinned
              </SidebarMenuButton>
              {pinnedCount > 0 && <SidebarMenuBadge>{pinnedCount}</SidebarMenuBadge>}
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton isActive={showTrash} onClick={() => setShowTrash(true)}>
                <TrashIcon />
                Trash
              </SidebarMenuButton>
              {trashCount > 0 && <SidebarMenuBadge>{trashCount}</SidebarMenuBadge>}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Tags */}
        <SidebarGroup>
          <SidebarGroupLabel>Tags</SidebarGroupLabel>
          <SidebarGroupAction
            title="New tag"
            onClick={() => {
              setCreateModalKey((k) => k + 1)
              setCreateModalOpen(true)
            }}
          >
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarMenu>
            {tags.length === 0 ? (
              <div className="px-2 py-1">
                <p className="text-muted-foreground text-xs">No tags yet</p>
                <p className="text-muted-foreground text-xs">Click + to create one</p>
              </div>
            ) : (
              tags.map((tag) => (
                <TagItem
                  key={tag.id}
                  tag={tag}
                  count={tagCounts[tag.id] ?? 0}
                  active={activeTags.includes(tag.id)}
                  onClick={(e) => toggleActiveTag(tag.id, e.ctrlKey || e.metaKey)}
                  onEdit={() => setEditingTag(tag)}
                  onDelete={() => setDeletingTag(tag)}
                />
              ))
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t">
        <VaultSwitcher />
      </SidebarFooter>

      <AppVersionDialog open={appVersionOpen} onClose={() => setAppVersionOpen(false)} />
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
    </ShadcnSidebar>
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
}): React.ReactNode {
  return (
    <SidebarMenuItem className="group">
      <SidebarMenuButton isActive={active} onClick={onClick}>
        <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
        {tag.name}
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover onClick={(e) => e.stopPropagation()}>
            <MoreHorizontalIcon />
          </SidebarMenuAction>
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
      {count > 0 && <SidebarMenuBadge className="group-hover:hidden">{count}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )
}
