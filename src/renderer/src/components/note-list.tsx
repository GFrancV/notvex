import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PinIcon, PinOffIcon, RotateCcwIcon, Trash2Icon, TrashIcon } from 'lucide-react'

import { useCreateNote } from '@/hooks/use-create-note'
import { notvex } from '@/lib/ipc'
import { cn, formatTimeAgo } from '@/lib/utils'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import type { NoteListItem } from '@shared/types'
import { TagFilter } from './tags/TagFilter'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { ScrollArea } from './ui/scroll-area'

const SEARCH_DEBOUNCE = 300

export function NoteList(): ReactNode {
  const { notes, activeNoteId, setActiveNoteId, loadNotes, loadTagCounts, noteTagsMap } =
    useVaultStore()
  const { searchQuery, activeTags, showTrash, showPinned } = useUiStore()
  const handleNewNote = useCreateNote()

  const [contextMenuNote, setContextMenuNote] = useState<NoteListItem | null>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Load all notes when trash/pinned/active-tags view changes
  useEffect(() => {
    void loadNotes({ trashed: showTrash })
  }, [showTrash, showPinned, loadNotes])

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

  const displayedNotes = showPinned || activeTags.length > 0 ? filteredNotes : notes

  const handlePin = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await notvex.notes.update(note.id, { isPinned: !note.isPinned })
      void loadNotes({ trashed: showTrash })
    },
    [showTrash, loadNotes]
  )

  const handleTrash = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await notvex.notes.trash(note.id)
      if (activeNoteId === note.id) setActiveNoteId(null)
      void loadNotes({ trashed: showTrash })
      void loadTagCounts()
    },
    [showTrash, activeNoteId, loadNotes, loadTagCounts, setActiveNoteId]
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
    if (activeTags.length > 0) return 'Notes by Tags'
    if (searchQuery) return 'Search results'
    return 'All Notes'
  }

  return (
    <div className="border-border flex w-70 shrink-0 flex-col border-r">
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 px-4 py-3">
        <h2 className="text-base">{listTitle()}</h2>
        <span className="text-muted-foreground text-xs">{filteredNotes.length}</span>
      </div>

      {/* Tag filter header */}
      <TagFilter />

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
      <ScrollArea className="flex-1 px-2.5">
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
          <>
            {displayedNotes.map((note) => (
              <DropdownMenu
                key={note.id}
                open={contextMenuOpen && contextMenuNote?.id === note.id}
                onOpenChange={(open) => {
                  if (!open) setContextMenuOpen(false)
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'mb-1.5 w-full rounded-md px-3 py-3.5 text-left transition-colors',
                      'hover:bg-accent focus:outline-none',
                      activeNoteId === note.id && 'bg-accent border-l-primary border-l-2'
                    )}
                    onClick={() => setActiveNoteId(note.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenuNote(note)
                      setContextMenuOpen(true)
                    }}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      {note.isPinned && (
                        <PinIcon className="text-primary fill-primary size-3 shrink-0" />
                      )}
                      <h3 className="truncate text-sm font-medium">{note.title || 'Untitled'}</h3>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <span>{formatTimeAgo(note.updatedAt)}</span>
                      {note.tags.length > 0 && (
                        <>
                          <span className="opacity-50">·</span>
                          <span className="flex-inline flex items-center gap-1.5">
                            <span
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: note.tags[0].color }}
                            />
                            {note.tags[0].name}
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="start">
                  {!showTrash ? (
                    <>
                      <DropdownMenuItem
                        onClick={(): void => {
                          void handlePin(note)
                        }}
                      >
                        {note.isPinned ? (
                          <>
                            <PinOffIcon className="size-4" />
                            Unpin
                          </>
                        ) : (
                          <>
                            <PinIcon className="size-4" />
                            Pin
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={(): void => {
                          void handleTrash(note)
                        }}
                      >
                        <Trash2Icon className="size-4" /> Move to trash
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem
                        onClick={(): void => {
                          void handleRestore(note)
                        }}
                      >
                        <RotateCcwIcon className="mr-2 h-4 w-4" /> Restore
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(): void => {
                          void handleDelete(note)
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <TrashIcon className="mr-2 h-4 w-4" /> Delete permanently
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  )
}
