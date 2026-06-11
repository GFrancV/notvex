import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { formatDistanceToNow } from 'date-fns'
import { Pin, PlusIcon, RotateCcw, Search, Trash, Trash2 } from 'lucide-react'

import type { NoteListItem } from '@shared/types'
import { notvex } from '../lib/ipc'
import { cn } from '../lib/utils'
import { useUiStore } from '../store/ui.store'
import { useVaultStore } from '../store/vault.store'
import { TagFilter } from './tags/TagFilter'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import { ScrollArea } from './ui/scroll-area'

const SEARCH_DEBOUNCE = 300

export function NoteList(): JSX.Element {
  const { notes, activeNoteId, setActiveNoteId, loadNotes, loadTagCounts, noteTagsMap } =
    useVaultStore()
  const { searchQuery, setSearchQuery, activeTags, showTrash, showPinned } = useUiStore()

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

  const createNote = async (): Promise<void> => {
    const res = await notvex.notes.create({ title: 'Untitled', content: '' })
    if (res.success) {
      await loadNotes({ trashed: false })
      setActiveNoteId(res.data.id)
      setSearchQuery('')
    }
  }

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

  return (
    <div className="flex w-70 shrink-0 flex-col border-r border-[#1e1e1e]">
      {/* Search + New */}
      <div className="flex items-center gap-2 border-b border-[#1e1e1e] p-3">
        <InputGroup className="w-full">
          <InputGroupInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes..."
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>

        {!showTrash && !showPinned && (
          <Button
            variant="ghost"
            size="xs"
            onClick={(): void => {
              void createNote()
            }}
            title="New note (Ctrl+N)"
            className="text-muted-foreground shrink-0"
          >
            <PlusIcon className="size-4" />
          </Button>
        )}
      </div>

      {/* Tag filter header */}
      <TagFilter />

      {/* Empty trash button */}
      {showTrash && notes.length > 0 && (
        <div className="border-b px-3 py-2">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={(): void => {
              void handleEmptyTrash()
            }}
          >
            <Trash className="mr-1 h-3.5 w-3.5" /> Empty trash ({notes.length})
          </Button>
        </div>
      )}

      {/* Note list */}
      <ScrollArea className="flex-1">
        {displayedNotes.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center justify-center p-8">
            <p className="text-sm">{emptyMessage()}</p>
            {!showTrash && !searchQuery && activeTags.length === 0 && (
              <button
                onClick={(): void => {
                  void createNote()
                }}
                className="text-primary hover:text-primary mt-2 text-xs"
              >
                Create your first note →
              </button>
            )}
          </div>
        ) : (
          <div>
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
                    className={cn(
                      'w-full border-b px-3 py-3 text-left transition-colors',
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
                    <div className="flex items-start gap-2">
                      {note.isPinned && <Pin className="text-primary mt-0.5 h-3 w-3 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{note.title || 'Untitled'}</p>
                        <div className="flex justify-between">
                          <p className="text-muted mt-0.5 text-xs">
                            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
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
                        <Pin className="mr-2 h-4 w-4" />
                        {note.isPinned ? 'Unpin' : 'Pin'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={(): void => {
                          void handleTrash(note)
                        }}
                      >
                        <Trash2 className="size-4" /> Move to trash
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem
                        onClick={(): void => {
                          void handleRestore(note)
                        }}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" /> Restore
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(): void => {
                          void handleDelete(note)
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash className="mr-2 h-4 w-4" /> Delete permanently
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
