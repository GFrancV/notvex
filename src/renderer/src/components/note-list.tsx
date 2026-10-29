import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { Trash2Icon } from 'lucide-react'
import { cn } from 'cn'

import { useDeleteNote } from '@/hooks/use-delete-note'
import { useDuplicateNote } from '@/hooks/use-duplicate-note'
import { useExportNote } from '@/hooks/use-export-note'
import { useRestoreNote } from '@/hooks/use-restore-note'
import { useTogglePin } from '@/hooks/use-toggle-pin'
import { useTrashNote } from '@/hooks/use-trash-note'
import { notvex } from '@/lib/ipc'
import { ipcSucceeded } from '@/lib/ipc-succeeded'
import { sortNotes } from '@/lib/sort-notes'
import { TITLEBAR_ROW } from '@/lib/titlebar'
import { usePrefsStore } from '@/store/prefs.store'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import type { NoteListItem } from '@shared/types'
import { ConfirmDeleteDialog } from './dialogs/ConfirmDeleteDialog'
import { ExportWarningDialog } from './dialogs/ExportWarningDialog'
import { NoteListRow } from './note-list-row'
import { NoteSortMenu } from './note-sort-menu'
import { Shortcut } from './Shortcut'
import { TagFilter } from './tags/TagFilter'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { ScrollArea } from './ui/scroll-area'

const LOADING_DELAY = 300

export function NoteList(): ReactNode {
  const { notes, notesTrashed, activeNoteId, setActiveNoteId, loadNotes, noteTagsMap } =
    useVaultStore()
  const { searchQuery, activeTags, showTrash, showPinned } = useUiStore()
  const duplicateNote = useDuplicateNote()
  const exportNote = useExportNote()
  const [exportTarget, setExportTarget] = useState<NoteListItem | null>(null)

  // Reload when the trash/pinned view changes
  useEffect(() => {
    void loadNotes({ trashed: showTrash })
  }, [showTrash, showPinned, loadNotes])

  // Until the new view's notes arrive, the loaded ones belong to the other view, and their rows
  // would offer this view's actions (a live note with Delete permanently). Show none instead.
  const loading = notesTrashed !== showTrash
  const [slowLoad, setSlowLoad] = useState(false)
  useEffect(() => {
    if (!loading) return
    // A fast load would only flash a loader, so it waits before saying anything.
    const timer = setTimeout(() => setSlowLoad(true), LOADING_DELAY)
    return (): void => {
      clearTimeout(timer)
      setSlowLoad(false)
    }
  }, [loading])

  const query = searchQuery.trim().toLowerCase()

  // Every filter, the title search included, runs here on the loaded list: a reload after a
  // pin, a trash or a save then keeps what the user is looking at.
  const filteredNotes = useMemo(() => {
    let result = notes
    if (showPinned) result = result.filter((n) => n.isPinned)
    else if (activeTags.length > 0) {
      result = result.filter((n) =>
        activeTags.every((tagId) => (noteTagsMap[n.id] ?? []).includes(tagId))
      )
    }
    if (query) result = result.filter((n) => n.title.toLowerCase().includes(query))
    return result
  }, [notes, showPinned, activeTags, noteTagsMap, query])

  // Sorted last so every filter gets the user's order.
  const noteSort = usePrefsStore((s) => s.noteSort)
  const displayedNotes = useMemo(
    () => sortNotes(filteredNotes, noteSort),
    [filteredNotes, noteSort]
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

  const restoreNote = useRestoreNote()
  const handleRestore = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await restoreNote(note.id)
    },
    [restoreNote]
  )

  const deleteNote = useDeleteNote()

  const [pendingDelete, setPendingDelete] = useState<NoteListItem | null>(null)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)
  const requestDelete = useCallback(async (note: NoteListItem): Promise<void> => {
    setPendingDelete(note)
  }, [])

  const handleEmptyTrash = async (): Promise<void> => {
    if (!(await ipcSucceeded(notvex.notes.emptyTrash(), "Couldn't empty the trash"))) return
    setActiveNoteId(null)
    void loadNotes({ trashed: true })
  }

  const emptyMessage = (): string => {
    if (query) return 'No results'
    if (showTrash) return 'Trash is empty'
    if (showPinned) return 'No pinned notes'
    if (activeTags.length > 0) return 'No notes with these tags'
    return 'No notes yet'
  }

  const listTitle = (): string => {
    if (showTrash) return 'Trash'
    if (showPinned) return 'Pinned'
    if (activeTags.length > 0) return query ? 'Search in tags' : 'Notes by tags'
    if (query) return 'Search results'
    return 'All notes'
  }

  return (
    <div className="border-border flex w-70 shrink-0 flex-col border-r">
      {/* Header */}
      <div className={cn('flex shrink-0 items-center justify-between gap-1.5 px-4', TITLEBAR_ROW)}>
        <h2 className="text-base">{listTitle()}</h2>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">{filteredNotes.length}</span>
          <NoteSortMenu />
        </div>
      </div>

      {/* Tag filter header */}
      <TagFilter count={filteredNotes.length} />

      {/* Empty trash button */}
      {showTrash && !loading && notes.length > 0 && (
        <div className="px-4 py-3">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={(): void => {
              setConfirmEmptyTrash(true)
            }}
          >
            <Trash2Icon className="size-3" /> Empty trash ({notes.length})
          </Button>
        </div>
      )}

      {/* Padded inside the viewport so it doesn't clip the selection pill's overhang. */}
      <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]]:px-2.5">
        {loading ? (
          slowLoad && <p className="text-muted-foreground p-8 text-center text-sm">Loading…</p>
        ) : displayedNotes.length === 0 ? (
          <Empty className="md:p-8">
            <EmptyHeader>
              <EmptyTitle className="text-muted-foreground text-sm font-normal">
                {emptyMessage()}
              </EmptyTitle>
              {!showTrash && !query && activeTags.length === 0 && (
                <EmptyDescription className="text-xs">
                  <Shortcut keys="Mod-n" /> to create
                </EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
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
              onExport={setExportTarget}
              onTrash={handleTrash}
              onRestore={handleRestore}
              onDelete={requestDelete}
            />
          ))
        )}
      </ScrollArea>

      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete note permanently?"
        description="This note will be deleted for good. It can't be undone."
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          if (pendingDelete) await deleteNote(pendingDelete.id)
        }}
      />
      <ConfirmDeleteDialog
        open={confirmEmptyTrash}
        onOpenChange={setConfirmEmptyTrash}
        title="Empty trash?"
        description="Every note in the trash will be deleted for good. It can't be undone."
        confirmLabel="Empty trash"
        onConfirm={handleEmptyTrash}
      />
      <ExportWarningDialog
        open={exportTarget !== null}
        onOpenChange={(open) => !open && setExportTarget(null)}
        title="Export note"
        onConfirm={async () => {
          if (exportTarget) await exportNote(exportTarget.id)
        }}
      />
    </div>
  )
}
