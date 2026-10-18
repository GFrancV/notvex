import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'

import { TrashIcon } from 'lucide-react'

import { useCreateNote } from '@/hooks/use-create-note'
import { useDuplicateNote } from '@/hooks/use-duplicate-note'
import { useTogglePin } from '@/hooks/use-toggle-pin'
import { useTrashNote } from '@/hooks/use-trash-note'
import { notvex } from '@/lib/ipc'
import { sortNotes } from '@/lib/sort-notes'
import { usePrefsStore } from '@/store/prefs.store'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import type { NoteListItem } from '@shared/types'
import { NoteListRow } from './note-list-row'
import { NoteSortMenu } from './note-sort-menu'
import { TagFilter } from './tags/TagFilter'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'

const SEARCH_DEBOUNCE = 300

export function NoteList(): ReactNode {
  const { notes, activeNoteId, setActiveNoteId, loadNotes, noteTagsMap } = useVaultStore()
  const { searchQuery, activeTags, showTrash, showPinned } = useUiStore()
  const handleNewNote = useCreateNote()
  const duplicateNote = useDuplicateNote()

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Reload when the trash/pinned view changes
  useEffect(() => {
    void loadNotes({ trashed: showTrash })
  }, [showTrash, showPinned, loadNotes])

  // The tag filter works client-side on `notes`, which may still hold the results of a search
  // made before the first tag was picked; start it from the full list.
  const tagsActive = activeTags.length > 0
  useEffect(() => {
    if (tagsActive) void loadNotes({ trashed: showTrash })
  }, [tagsActive, showTrash, loadNotes])

  // Debounced IPC search — only when no tag filter active (tag filter handled client-side)
  useEffect(() => {
    if (activeTags.length > 0) return
    clearTimeout(searchTimer.current)
    if (!searchQuery.trim()) {
      void loadNotes({ trashed: showTrash })
      return
    }
    searchTimer.current = setTimeout((): void => {
      void (async (): Promise<void> => {
        const res = await notvex.notes.search(searchQuery)
        if (res.success) useVaultStore.getState().setNotes(res.data)
      })()
    }, SEARCH_DEBOUNCE)
    return () => clearTimeout(searchTimer.current)
  }, [searchQuery, showTrash, activeTags, loadNotes])

  // Client-side filtering: pinned view, multi-tag AND, and search-on-top-of-tags
  const filteredNotes = useMemo(() => {
    let result = notes
    if (showPinned) {
      result = result.filter((n) => n.isPinned)
      if (searchQuery.trim()) {
        const lower = searchQuery.toLowerCase()
        result = result.filter((n) => n.title.toLowerCase().includes(lower))
      }
      return result
    }
    if (activeTags.length > 0) {
      result = result.filter((n) =>
        activeTags.every((tagId) => (noteTagsMap[n.id] ?? []).includes(tagId))
      )
      if (searchQuery.trim()) {
        const lower = searchQuery.toLowerCase()
        result = result.filter((n) => n.title.toLowerCase().includes(lower))
      }
    }
    return result
  }, [notes, showPinned, activeTags, noteTagsMap, searchQuery])

  // Sorted last so every path that fills `notes` (list, search, tags) gets the user's order.
  const noteSort = usePrefsStore((s) => s.noteSort)
  const displayedNotes = useMemo(
    () => sortNotes(showPinned || activeTags.length > 0 ? filteredNotes : notes, noteSort),
    [showPinned, activeTags.length, filteredNotes, notes, noteSort]
  )

  const togglePin = useTogglePin()
  const handlePin = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await togglePin(note)
    },
    [togglePin]
  )

  const trashNote = useTrashNote()
  const handleTrash = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await trashNote(note.id)
    },
    [trashNote]
  )

  const handleRestore = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await notvex.notes.restore(note.id)
      void loadNotes({ trashed: true })
    },
    [loadNotes]
  )

  const handleDelete = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await notvex.notes.delete(note.id)
      if (activeNoteId === note.id) setActiveNoteId(null)
      void loadNotes({ trashed: true })
    },
    [activeNoteId, loadNotes, setActiveNoteId]
  )

  const handleEmptyTrash = async (): Promise<void> => {
    await notvex.notes.emptyTrash()
    setActiveNoteId(null)
    void loadNotes({ trashed: true })
  }

  const emptyMessage = (): string => {
    if (showTrash) return 'Trash is empty'
    if (showPinned) return 'No pinned notes'
    if (activeTags.length > 0) return 'No notes with these tags'
    if (searchQuery) return 'No results'
    return 'No notes yet'
  }

  const listTitle = (): string => {
    if (showTrash) return 'Trash'
    if (showPinned) return 'Pinned notes'
    if (activeTags.length > 0) return searchQuery.trim() ? 'Search in tags' : 'Notes by Tags'
    if (searchQuery) return 'Search results'
    return 'All Notes'
  }

  return (
    <div className="border-border flex w-70 shrink-0 flex-col border-r">
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 px-4 py-3">
        <h2 className="text-base">{listTitle()}</h2>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">{filteredNotes.length}</span>
          <NoteSortMenu />
        </div>
      </div>

      {/* Tag filter header */}
      <TagFilter count={filteredNotes.length} />

      {/* Empty trash button */}
      {showTrash && notes.length > 0 && (
        <div className="px-4 py-3">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={(): void => {
              void handleEmptyTrash()
            }}
          >
            <TrashIcon className="size-3" /> Empty trash ({notes.length})
          </Button>
        </div>
      )}

      {/* Note list */}
      <ScrollArea className="min-h-0 flex-1 px-2.5">
        {displayedNotes.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center justify-center p-8">
            <p className="text-sm">{emptyMessage()}</p>
            {!showTrash && !searchQuery && activeTags.length === 0 && (
              <button
                type="button"
                onClick={(): void => {
                  void handleNewNote()
                }}
                className="text-primary hover:text-primary mt-2 text-xs"
              >
                Create your first note →
              </button>
            )}
          </div>
        ) : (
          displayedNotes.map((note) => (
            <NoteListRow
              key={note.id}
              note={note}
              isActive={activeNoteId === note.id}
              inTrash={showTrash}
              date={noteSort.field === 'createdAt' ? note.createdAt : note.updatedAt}
              onSelect={setActiveNoteId}
              onPin={handlePin}
              onDuplicate={duplicateNote}
              onTrash={handleTrash}
              onRestore={handleRestore}
              onDelete={handleDelete}
            />
          ))
        )}
      </ScrollArea>
    </div>
  )
}
