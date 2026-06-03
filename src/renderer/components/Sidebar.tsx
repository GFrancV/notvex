import React, { useEffect, useState } from 'react'
import { notvex } from '../lib/ipc'
import { useVaultStore } from '../store/vault.store'
import { useUiStore } from '../store/ui.store'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import {
  Popover, PopoverContent, PopoverTrigger,
} from './ui/popover'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  FileText, Pin, Trash2, Tag as TagIcon, Settings, Lock, Plus, ChevronRight,
} from 'lucide-react'
import { cn } from '../lib/utils'
import type { Tag } from '../../preload/index'

export function Sidebar(): JSX.Element {
  const { tags, tagCounts, loadTags, loadTagCounts, notes, setStatus, setActiveNoteId, setNotes } = useVaultStore()
  const { activeTagFilter, showTrash, setActiveTagFilter, setShowTrash, setSettingsOpen } = useUiStore()

  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false)
  const [autoLockMinutes, setAutoLockMinutes] = useState(15)
  const [vaultPath, setVaultPath] = useState<string | null>(null)

  useEffect(() => {
    loadTags()
    loadTagCounts()
    notvex.prefs.get().then((res) => {
      if (res.success && res.data && typeof res.data === 'object') {
        const prefs = res.data as { autoLockMinutes?: number; vaultPath?: string | null }
        setAutoLockMinutes(prefs.autoLockMinutes ?? 15)
        setVaultPath(prefs.vaultPath ?? null)
      }
    })
  }, [])

  const handleLock = async (): Promise<void> => {
    await notvex.vault.close()
    setStatus('locked')
    setActiveNoteId(null)
    setNotes([])
  }

  const handleAutoLockChange = (minutes: number): void => {
    setAutoLockMinutes(minutes)
    notvex.prefs.set('autoLockMinutes', minutes)
  }

  const allNotesCount = notes.filter((n) => !n.isTrashed).length
  const pinnedCount = notes.filter((n) => n.isPinned && !n.isTrashed).length
  const trashCount = notes.filter((n) => n.isTrashed).length

  return (
    <div className="flex w-60 shrink-0 flex-col bg-[#0f0f0f] border-r border-[#1e1e1e]">
      {/* App header */}
      <div className="flex items-center justify-between px-4 py-4 titlebar-drag">
        <span className="text-sm font-semibold text-[#e5e5e5] titlebar-no-drag select-none">Notvex</span>
        <div className="flex items-center gap-1 titlebar-no-drag">
          <button
            onClick={handleLock}
            title="Lock vault (Ctrl+L)"
            className="rounded p-1 text-[#737373] hover:text-[#e5e5e5] hover:bg-[#1a1a1a] transition-colors"
          >
            <Lock className="h-3.5 w-3.5" />
          </button>
          <Popover open={settingsPopoverOpen} onOpenChange={setSettingsPopoverOpen}>
            <PopoverTrigger asChild>
              <button className="rounded p-1 text-[#737373] hover:text-[#e5e5e5] hover:bg-[#1a1a1a] transition-colors">
                <Settings className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-[#e5e5e5] mb-3">Settings</p>
              </div>
              <div className="space-y-2">
                <Label>Auto-lock after</Label>
                <select
                  value={autoLockMinutes}
                  onChange={(e) => handleAutoLockChange(Number(e.target.value))}
                  className="w-full rounded-md border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5 text-sm text-[#e5e5e5] focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                  <p className="text-xs text-[#737373] break-all">{vaultPath}</p>
                </div>
              )}
              <Separator />
              <Button variant="destructive" size="sm" className="w-full" onClick={handleLock}>
                <Lock className="h-3.5 w-3.5 mr-2" /> Lock vault
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Separator />

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <nav className="p-2 space-y-0.5">
          <NavItem
            icon={<FileText className="h-3.5 w-3.5" />}
            label="All Notes"
            count={allNotesCount}
            active={!activeTagFilter && !showTrash}
            onClick={() => { setActiveTagFilter(null); setShowTrash(false) }}
          />
          <NavItem
            icon={<Pin className="h-3.5 w-3.5" />}
            label="Pinned"
            count={pinnedCount}
            active={false}
            onClick={() => { setActiveTagFilter(null); setShowTrash(false) }}
          />
          <NavItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Trash"
            count={trashCount}
            active={showTrash}
            onClick={() => setShowTrash(true)}
          />
        </nav>

        {/* Tags section */}
        <div className="px-2 py-1">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#737373]">Tags</span>
          </div>
          {tags.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[#737373]">No tags yet</p>
          ) : (
            <div className="space-y-0.5">
              {tags.map((tag) => (
                <TagItem
                  key={tag.id}
                  tag={tag}
                  count={tagCounts[tag.id] ?? 0}
                  active={activeTagFilter === tag.id}
                  onClick={() => setActiveTagFilter(tag.id)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Status indicator */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-[#1e1e1e]">
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-xs text-[#737373]">Vault unlocked</span>
      </div>
    </div>
  )
}

function NavItem({
  icon, label, count, active, onClick,
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
          : 'text-[#737373] hover:bg-[#1a1a1a] hover:text-[#a3a3a3]',
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {count > 0 && (
        <span className="text-xs text-[#737373]">{count}</span>
      )}
    </button>
  )
}

function TagItem({
  tag, count, active, onClick,
}: {
  tag: Tag
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
          : 'text-[#737373] hover:bg-[#1a1a1a] hover:text-[#a3a3a3]',
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
      <span className="flex-1 text-left text-xs">{tag.name}</span>
      {count > 0 && <span className="text-xs text-[#737373]">{count}</span>}
    </button>
  )
}
