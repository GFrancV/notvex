import { useState, useEffect, useCallback, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { notvex } from '../lib/ipc'
import { useVaultStore } from '../store/vault.store'
import { useUiStore } from '../store/ui.store'
import { ScrollArea } from './ui/scroll-area'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Pin, Trash2, RotateCcw, Trash, Plus, Search } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { NoteListItem } from '../../preload/index'

const SEARCH_DEBOUNCE = 300

export function NoteList(): JSX.Element {
  const { notes, activeNoteId, setActiveNoteId, loadNotes, loadTagCounts, refreshAll } = useVaultStore()
  const { searchQuery, setSearchQuery, activeTagFilter, showTrash } = useUiStore()

  const [contextMenuNote, setContextMenuNote] = useState<NoteListItem | null>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  // Load notes when filter changes
  useEffect(() => {
    loadNotes({ trashed: showTrash, tagId: activeTagFilter ?? undefined })
  }, [showTrash, activeTagFilter])

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!searchQuery.trim()) {
      loadNotes({ trashed: showTrash, tagId: activeTagFilter ?? undefined })
      return
    }
    searchTimer.current = setTimeout(async () => {
      const res = await notvex.notes.search(searchQuery)
      if (res.success) useVaultStore.getState().setNotes(res.data)
    }, SEARCH_DEBOUNCE)
  }, [searchQuery])

  const createNote = async (): Promise<void> => {
    const res = await notvex.notes.create({ title: 'Untitled', content: '' })
    if (res.success) {
      await loadNotes({ trashed: false, tagId: activeTagFilter ?? undefined })
      setActiveNoteId(res.data.id)
      setSearchQuery('')
    }
  }

  const handlePin = useCallback(async (note: NoteListItem): Promise<void> => {
    await notvex.notes.update(note.id, { isPinned: !note.isPinned })
    loadNotes({ trashed: showTrash, tagId: activeTagFilter ?? undefined })
  }, [showTrash, activeTagFilter])

  const handleTrash = useCallback(async (note: NoteListItem): Promise<void> => {
    await notvex.notes.trash(note.id)
    if (activeNoteId === note.id) setActiveNoteId(null)
    loadNotes({ trashed: showTrash, tagId: activeTagFilter ?? undefined })
    loadTagCounts()
  }, [showTrash, activeTagFilter, activeNoteId])

  const handleRestore = useCallback(async (note: NoteListItem): Promise<void> => {
    await notvex.notes.restore(note.id)
    loadNotes({ trashed: true })
  }, [])

  const handleDelete = useCallback(async (note: NoteListItem): Promise<void> => {
    await notvex.notes.delete(note.id)
    if (activeNoteId === note.id) setActiveNoteId(null)
    loadNotes({ trashed: true })
  }, [activeNoteId])

  const handleEmptyTrash = async (): Promise<void> => {
    await notvex.notes.emptyTrash()
    setActiveNoteId(null)
    loadNotes({ trashed: true })
  }

  return (
    <div className="flex w-[280px] shrink-0 flex-col border-r border-[#1e1e1e]">
      {/* Search + New */}
      <div className="flex items-center gap-2 p-3 border-b border-[#1e1e1e]">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#737373]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full rounded-md bg-[#1a1a1a] border border-[#2a2a2a] pl-8 pr-3 py-1.5 text-xs text-[#e5e5e5] placeholder:text-[#737373] focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        {!showTrash && (
          <Button variant="ghost" size="icon" onClick={createNote} title="New note (Ctrl+N)" className="shrink-0 h-8 w-8">
            <Plus className="h-4 w-4 text-[#737373]" />
          </Button>
        )}
      </div>

      {/* Empty trash button */}
      {showTrash && notes.length > 0 && (
        <div className="px-3 py-2 border-b border-[#1e1e1e]">
          <Button variant="destructive" size="sm" className="w-full text-xs" onClick={handleEmptyTrash}>
            <Trash className="h-3.5 w-3.5 mr-1" /> Empty trash ({notes.length})
          </Button>
        </div>
      )}

      {/* Note list */}
      <ScrollArea className="flex-1">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-[#737373]">
            <p className="text-sm">{showTrash ? 'Trash is empty' : searchQuery ? 'No results' : 'No notes yet'}</p>
            {!showTrash && !searchQuery && (
              <button onClick={createNote} className="mt-2 text-xs text-emerald-500 hover:text-emerald-400">
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
                onOpenChange={(open) => { if (!open) setContextMenuOpen(false) }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'w-full text-left px-3 py-3 border-b border-[#1a1a1a] transition-colors',
                      'hover:bg-[#1a1a1a] focus:outline-none',
                      activeNoteId === note.id && 'bg-[#1e1e1e] border-l-2 border-l-emerald-500',
                    )}
                    onClick={() => setActiveNoteId(note.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenuNote(note)
                      setContextMenuOpen(true)
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {note.isPinned && <Pin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />}
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-[#e5e5e5]">
                          {note.title || 'Untitled'}
                        </p>
                        <p className="text-xs text-[#737373] mt-0.5">
                          {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="start">
                  {!showTrash ? (
                    <>
                      <DropdownMenuItem onClick={() => handlePin(note)}>
                        <Pin className="h-4 w-4 mr-2" />
                        {note.isPinned ? 'Unpin' : 'Pin'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleTrash(note)}
                        className="text-red-400 focus:text-red-400"
                      >
                        <Trash2 className="h-4 w-4 mr-2" /> Move to trash
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => handleRestore(note)}>
                        <RotateCcw className="h-4 w-4 mr-2" /> Restore
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDelete(note)}
                        className="text-red-400 focus:text-red-400"
                      >
                        <Trash className="h-4 w-4 mr-2" /> Delete permanently
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
