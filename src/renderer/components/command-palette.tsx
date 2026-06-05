import React, { useEffect, useCallback } from 'react'

import { Command } from 'cmdk'
import { FileText, Plus, Lock, Columns2, Trash2 } from 'lucide-react'

import type { NoteListItem } from '../../shared/types'
import { notvex } from '../lib/ipc'
import { useUiStore } from '../store/ui.store'
import { useVaultStore } from '../store/vault.store'

export function CommandPalette(): JSX.Element | null {
  const { commandPaletteOpen, setCommandPaletteOpen, togglePreview, setShowTrash } = useUiStore()
  const {
    notes,
    setStatus,
    setActiveNoteId,
    loadNotes,
    setNotes,
    setActiveNoteId: selectNote,
  } = useVaultStore()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
      if (e.key === 'Escape') setCommandPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return (): void => window.removeEventListener('keydown', onKey)
  }, [setCommandPaletteOpen])

  const run = useCallback(
    (action: () => void | Promise<void>): void => {
      setCommandPaletteOpen(false)
      void action()
    },
    [setCommandPaletteOpen],
  )

  const handleNewNote = async (): Promise<void> => {
    const res = await notvex.notes.create({ title: 'Untitled', content: '' })
    if (res.success) {
      await loadNotes()
      setActiveNoteId(res.data.id)
    }
  }

  const handleLock = async (): Promise<void> => {
    await notvex.vault.close()
    setStatus('locked')
    setActiveNoteId(null)
    setNotes([])
  }

  if (!commandPaletteOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[20vh] backdrop-blur-sm"
      role="none"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] shadow-2xl"
        role="none"
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#737373]">
          <div className="flex items-center border-b border-[#2a2a2a] px-3">
            <Command.Input
              placeholder="Search notes, run commands…"
              className="flex h-12 w-full bg-transparent text-sm text-[#e5e5e5] placeholder:text-[#737373] focus:outline-none"
            />
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-[#737373]">
              No results found.
            </Command.Empty>

            {/* Commands */}
            <Command.Group heading="Commands">
              <PaletteItem
                icon={<Plus className="h-4 w-4" />}
                label="New Note"
                shortcut="Ctrl+N"
                onSelect={() => run(handleNewNote)}
              />
              <PaletteItem
                icon={<Columns2 className="h-4 w-4" />}
                label="Toggle Preview"
                shortcut="Ctrl+P"
                onSelect={() => run(togglePreview)}
              />
              <PaletteItem
                icon={<Trash2 className="h-4 w-4" />}
                label="Show Trash"
                onSelect={() => run(() => setShowTrash(true))}
              />
              <PaletteItem
                icon={<Lock className="h-4 w-4" />}
                label="Lock Vault"
                shortcut="Ctrl+L"
                onSelect={() => run(handleLock)}
              />
            </Command.Group>

            {/* Recent notes */}
            {notes.filter((n) => !n.isTrashed).length > 0 && (
              <Command.Group heading="Notes">
                {notes
                  .filter((n) => !n.isTrashed)
                  .slice(0, 8)
                  .map((note) => (
                    <NoteItem
                      key={note.id}
                      note={note}
                      onSelect={() => run(() => selectNote(note.id))}
                    />
                  ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}

function PaletteItem({
  icon,
  label,
  shortcut,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  onSelect: () => void
}): JSX.Element {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[#e5e5e5] transition-colors aria-selected:bg-[#222]"
    >
      <span className="text-[#737373]">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <kbd className="font-mono text-xs text-[#737373]">{shortcut}</kbd>}
    </Command.Item>
  )
}

function NoteItem({ note, onSelect }: { note: NoteListItem; onSelect: () => void }): JSX.Element {
  return (
    <Command.Item
      value={note.title}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[#e5e5e5] transition-colors aria-selected:bg-[#222]"
    >
      <FileText className="h-4 w-4 text-[#737373]" />
      <span className="flex-1 truncate">{note.title || 'Untitled'}</span>
    </Command.Item>
  )
}
