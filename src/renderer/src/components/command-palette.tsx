import { type JSX, useCallback, useEffect } from 'react'

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

export function CommandPalette(): JSX.Element | null {
  const {
    commandPaletteOpen,
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
    [setCommandPaletteOpen]
  )

  const handleLock = async (): Promise<void> => {
    await notvex.vault.close()
    setStatus('locked')
    setActiveNoteId(null)
    setNotes([])
  }

  const noteHasTags = activeNoteId ? (noteTagsMap[activeNoteId] ?? []).length > 0 : false

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder="Search notes, run commands…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Commands">
          <CommandItem onSelect={() => run(handleNewNote)}>
            <PlusIcon />
            <span>New Note</span>
            <CommandShortcut>Ctrl+N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(toggleEditorMode)}>
            <EyeIcon />
            <span>Toggle Reading View</span>
            <CommandShortcut>Ctrl+Shift+E</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => setShowTrash(true))}>
            <Trash2Icon />
            <span>Show Trash</span>
          </CommandItem>
          <CommandItem onSelect={() => run(handleLock)}>
            <LockIcon />
            <span>Lock Vault</span>
            <CommandShortcut>Ctrl+L</CommandShortcut>
          </CommandItem>
          {activeNoteId && (
            <CommandItem onSelect={() => run(() => setTagSelectorNoteId(activeNoteId))}>
              <TagIcon />
              <span>Tag note with...</span>
            </CommandItem>
          )}
          {activeNoteId && noteHasTags && (
            <CommandItem onSelect={() => run(() => setRemoveTagNoteId(activeNoteId))}>
              <XIcon />
              <span>Remove tag from note...</span>
            </CommandItem>
          )}
        </CommandGroup>

        {/* Recent notes */}
        {notes.filter((n) => !n.isTrashed).length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Notes">
              {notes
                .filter((n) => !n.isTrashed)
                .slice(0, 8)
                .map((note) => (
                  <CommandItem key={note.id} onSelect={() => run(() => selectNote(note.id))}>
                    <FileTextIcon />
                    <span>{note.title || 'Untitled'}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
