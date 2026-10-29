import React, { useEffect, useRef, useState } from 'react'

import {
  FileIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  XIcon
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from 'cn'

import { useCreateNote } from '@/hooks/use-create-note'
import { useIsDev } from '@/hooks/use-is-dev'
import { notvex } from '@/lib/ipc'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import type { Tag } from '@shared/types'
import { AppLogo } from './AppLogo'
import { HelpMenu } from './HelpMenu'
import { SettingsDialog, type SettingsTab } from './settings-dialog'
import { Shortcut } from './Shortcut'
import { TagCreateModal } from './tags/TagCreateModal'
import { TagDeleteModal } from './tags/TagDeleteModal'
import { TagItem } from './tags/TagItem'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator
} from './ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { VaultSwitcher } from './VaultSwitcher'

export function Sidebar(): React.ReactNode {
  const { loadTags, loadTagCounts } = useVaultStore()
  const { tags, tagCounts, noteCounts } = useVaultStore(
    useShallow((s) => ({
      tags: s.tags,
      tagCounts: s.tagCounts,
      noteCounts: s.noteCounts
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

  const handleNewNote = useCreateNote()
  const isDev = useIsDev()

  const searchContainerRef = useRef<HTMLDivElement>(null)
  // null = closed; the value is the tab it opens on.
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
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

  const { live: allNotesCount, pinned: pinnedCount, trashed: trashCount } = noteCounts

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
            {isDev && <Badge variant="secondary">Dev</Badge>}
          </span>
          <div className="flex items-center gap-1">
            <HelpMenu onOpenAbout={() => setSettingsTab('about')} />
            <Button
              variant="ghost"
              size="xs"
              className="titlebar-no-drag z-50"
              aria-label="Settings"
              onClick={() => setSettingsTab('security')}
            >
              <SettingsIcon />
            </Button>
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
                placeholder="Search…"
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
                  <Shortcut keys="Mod-Shift-f" />
                )}
              </InputGroupAddon>
            </InputGroup>
          </div>

          {!showTrash && !showPinned && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={(): void => {
                    void handleNewNote()
                  }}
                  aria-label="New note"
                  className="text-muted-foreground shrink-0"
                >
                  <PlusIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                New note <Shortcut keys="Mod-n" />
              </TooltipContent>
            </Tooltip>
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
                All notes
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
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarGroupAction
                aria-label="New tag"
                onClick={() => {
                  setCreateModalKey((k) => k + 1)
                  setCreateModalOpen(true)
                }}
              >
                <PlusIcon />
              </SidebarGroupAction>
            </TooltipTrigger>
            <TooltipContent>New tag</TooltipContent>
          </Tooltip>
          <SidebarMenu>
            {tags.length === 0 ? (
              <Empty className="gap-0 p-2 md:p-2">
                <EmptyHeader className="gap-0">
                  <EmptyTitle className="text-muted-foreground text-xs font-normal">
                    No tags yet
                  </EmptyTitle>
                  <EmptyDescription className="text-xs">Click + to create one</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              tags.map((tag) => (
                <TagItem
                  key={tag.id}
                  tag={tag}
                  count={tagCounts[tag.id] ?? 0}
                  active={activeTags.includes(tag.id)}
                  onClick={(e) => toggleActiveTag(tag.id, e.ctrlKey || e.metaKey)}
                  onToggle={() => toggleActiveTag(tag.id, true)}
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

      <SettingsDialog
        open={settingsTab !== null}
        initialTab={settingsTab ?? undefined}
        onOpenChange={(open) => !open && setSettingsTab(null)}
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
