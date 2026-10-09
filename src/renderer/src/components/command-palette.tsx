import { type JSX, type ReactNode, useCallback, useEffect, useState } from 'react'

import { toast } from 'sonner'

import { EyeIcon, FileTextIcon, LockIcon, PlusIcon, TagIcon, Trash2Icon, XIcon } from 'lucide-react'

import { useCreateNote } from '@/hooks/use-create-note'
import { notvex } from '@/lib/ipc'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from './ui/command'

const RECENT_NOTES = 8
const INVISIBLE = ['\u200b', '\u200c', '\u200d', '\u2060']
// Note values always start with a title, so a bare suffix character never collides with one.
const CREATE_NOTE_VALUE = INVISIBLE[0]

// cmdk keys items by `value`, so notes sharing a title would highlight together. A suffix of
// zero-width characters (which cmdk doesn't trim and nobody types) keeps each value unique while
// matching still runs on the title alone.
function noteValue(title: string, index: number): string {
  let suffix = ''
  let i = index
  do {
    suffix += INVISIBLE[i % INVISIBLE.length]
    i = Math.floor(i / INVISIBLE.length)
  } while (i > 0)
  return title + suffix
}

export function CommandPalette(): JSX.Element | null {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUiStore()

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

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <PaletteContent />
    </CommandDialog>
  )
}

// Mounted only while the dialog is open, so the query resets on every close.
function PaletteContent(): ReactNode {
  const {
    setCommandPaletteOpen,
    toggleEditorMode,
    setShowTrash,
    setTagSelectorNoteId,
    setRemoveTagNoteId
  } = useUiStore()
  const {
    notes,
    setStatus,
    setActiveNoteId,
    setNotes,
    setActiveNoteId: selectNote,
    activeNoteId,
    noteTagsMap
  } = useVaultStore()
  const handleNewNote = useCreateNote()
  const [query, setQuery] = useState('')

  const run = useCallback(
    (action: () => void | Promise<void>): void => {
      setCommandPaletteOpen(false)
      void action()
    },
    [setCommandPaletteOpen]
  )

  const handleLock = async (): Promise<void> => {
    await notvex.vault.close()
    setStatus('locked')
    setActiveNoteId(null)
    setNotes([])
  }

  const handleCreate = async (title?: string): Promise<void> => {
    try {
      await handleNewNote(title)
    } catch {
      toast.error('Failed to create note')
    }
  }

  const noteHasTags = activeNoteId ? (noteTagsMap[activeNoteId] ?? []).length > 0 : false
  const activeNotes = notes.filter((n) => !n.isTrashed)
  const shownNotes = query ? activeNotes : activeNotes.slice(0, RECENT_NOTES)
  const newTitle = query.trim()

  return (
    <>
      <CommandInput
        placeholder="Search notes, run commands…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {!newTitle && <CommandEmpty>No results found.</CommandEmpty>}
        <CommandGroup heading="Commands">
          <CommandItem
            keywords={['create note', 'add note', 'blank']}
            onSelect={() => run(handleCreate)}
          >
            <PlusIcon />
            <span>New Note</span>
            <CommandShortcut>Ctrl+N</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={['preview', 'read mode', 'edit mode', 'markdown']}
            onSelect={() => run(toggleEditorMode)}
          >
            <EyeIcon />
            <span>Toggle Reading View</span>
            <CommandShortcut>Ctrl+Shift+E</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={['deleted notes', 'bin', 'recycle', 'restore']}
            onSelect={() => run(() => setShowTrash(true))}
          >
            <Trash2Icon />
            <span>Show Trash</span>
          </CommandItem>
          <CommandItem
            keywords={['close vault', 'logout', 'sign out', 'exit']}
            onSelect={() => run(handleLock)}
          >
            <LockIcon />
            <span>Lock Vault</span>
            <CommandShortcut>Ctrl+L</CommandShortcut>
          </CommandItem>
          {activeNoteId && (
            <CommandItem
              keywords={['add tag', 'assign tag', 'label']}
              onSelect={() => run(() => setTagSelectorNoteId(activeNoteId))}
            >
              <TagIcon />
              <span>Tag note with...</span>
            </CommandItem>
          )}
          {activeNoteId && noteHasTags && (
            <CommandItem
              keywords={['untag', 'delete tag', 'unlabel']}
              onSelect={() => run(() => setRemoveTagNoteId(activeNoteId))}
            >
              <XIcon />
              <span>Remove tag from note...</span>
            </CommandItem>
          )}
        </CommandGroup>

        {shownNotes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Notes">
              {shownNotes.map((note, i) => (
                <CommandItem
                  key={note.id}
                  value={noteValue(note.title || 'Untitled', i)}
                  onSelect={() => run(() => selectNote(note.id))}
                >
                  <FileTextIcon />
                  <span>{note.title || 'Untitled'}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Its value never matches, so cmdk scores it 0 and sorts its group last (Enter keeps picking a
            real match) and would hide both item and group without forceMount. */}
        {newTitle && (
          <CommandGroup forceMount>
            <CommandItem
              forceMount
              value={CREATE_NOTE_VALUE}
              onSelect={() => run(() => handleCreate(newTitle))}
            >
              <PlusIcon />
              <span>{`Create note "${newTitle}"`}</span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </>
  )
}
