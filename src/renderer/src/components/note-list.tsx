import { useCallback, useEffect, useRef, useState } from 'react'

import { formatDistanceToNow } from 'date-fns'
import { Pin, Plus, RotateCcw, Search, Trash, Trash2 } from 'lucide-react'

import type { NoteListItem } from '../../../shared/types'
import { notvex } from '../lib/ipc'
import { cn } from '../lib/utils'
import { useUiStore } from '../store/ui.store'
import { useVaultStore } from '../store/vault.store'
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

export function NoteList(): JSX.Element {
  const { notes, activeNoteId, setActiveNoteId, loadNotes, loadTagCounts } = useVaultStore()
  const { searchQuery, setSearchQuery, activeTagFilter, showTrash } = useUiStore()

  const [contextMenuNote, setContextMenuNote] = useState<NoteListItem | null>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  // Load notes when filter changes
  useEffect(() => {
    void loadNotes({ trashed: showTrash, tagId: activeTagFilter ?? undefined })
  }, [showTrash, activeTagFilter, loadNotes])

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!searchQuery.trim()) {
      void loadNotes({ trashed: showTrash, tagId: activeTagFilter ?? undefined })
      return
    }
    searchTimer.current = setTimeout((): void => {
      void (async (): Promise<void> => {
        const res = await notvex.notes.search(searchQuery)
        if (res.success) useVaultStore.getState().setNotes(res.data)
      })()
    }, SEARCH_DEBOUNCE)
  }, [searchQuery, showTrash, activeTagFilter, loadNotes])

  const createNote = async (): Promise<void> => {
    const res = await notvex.notes.create({ title: 'Untitled', content: '' })
    if (res.success) {
      await loadNotes({ trashed: false, tagId: activeTagFilter ?? undefined })
      setActiveNoteId(res.data.id)
      setSearchQuery('')
    }
  }

  const handlePin = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await notvex.notes.update(note.id, { isPinned: !note.isPinned })
      void loadNotes({ trashed: showTrash, tagId: activeTagFilter ?? undefined })
    },
    [showTrash, activeTagFilter, loadNotes]
  )

  const handleTrash = useCallback(
    async (note: NoteListItem): Promise<void> => {
      await notvex.notes.trash(note.id)
      if (activeNoteId === note.id) setActiveNoteId(null)
      void loadNotes({ trashed: showTrash, tagId: activeTagFilter ?? undefined })
      void loadTagCounts()
    },
    [showTrash, activeTagFilter, activeNoteId, loadNotes, loadTagCounts, setActiveNoteId]
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

  return (
    <div className="flex w-[280px] shrink-0 flex-col border-r border-[#1e1e1e]">
      {/* Search + New */}
      <div className="flex items-center gap-2 border-b border-[#1e1e1e] p-3">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#737373]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full rounded-md border border-[#2a2a2a] bg-[#1a1a1a] py-1.5 pr-3 pl-8 text-xs text-[#e5e5e5] placeholder:text-[#737373] focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          />
        </div>
        {!showTrash && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(): void => {
              void createNote()
            }}
            title="New note (Ctrl+N)"
            className="h-8 w-8 shrink-0"
          >
            <Plus className="h-4 w-4 text-[#737373]" />
          </Button>
        )}
      </div>

      {/* Empty trash button */}
      {showTrash && notes.length > 0 && (
        <div className="border-b border-[#1e1e1e] px-3 py-2">
          <Button
            variant="destructive"
            size="sm"
            className="w-full text-xs"
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
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-[#737373]">
            <p className="text-sm">
              {showTrash ? 'Trash is empty' : searchQuery ? 'No results' : 'No notes yet'}
            </p>
            {!showTrash && !searchQuery && (
              <button
                onClick={(): void => {
                  void createNote()
                }}
                className="mt-2 text-xs text-emerald-500 hover:text-emerald-400"
              >
                Create your first note →
              </button>
            )}
          </div>
        ) : (
          <div>
            {notes.map((note) => (
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
                      'w-full border-b border-[#1a1a1a] px-3 py-3 text-left transition-colors',
                      'hover:bg-[#1a1a1a] focus:outline-none',
                      activeNoteId === note.id && 'border-l-2 border-l-emerald-500 bg-[#1e1e1e]'
                    )}
                    onClick={() => setActiveNoteId(note.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenuNote(note)
                      setContextMenuOpen(true)
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {note.isPinned && (
                        <Pin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#e5e5e5]">
                          {note.title || 'Untitled'}
                        </p>
                        <p className="mt-0.5 text-xs text-[#737373]">
                          {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
                        </p>
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
                        onClick={(): void => {
                          void handleTrash(note)
                        }}
                        className="text-red-400 focus:text-red-400"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Move to trash
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
                        className="text-red-400 focus:text-red-400"
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
