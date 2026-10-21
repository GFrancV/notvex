import type { ReactNode } from 'react'

import {
  CopyIcon,
  DownloadIcon,
  PinIcon,
  PinOffIcon,
  RotateCcwIcon,
  Trash2Icon,
  TrashIcon
} from 'lucide-react'
import { cn } from 'cn'

import { formatTimeAgo } from '@/lib/utils'
import type { NoteListItem } from '@shared/types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from './ui/context-menu'

interface NoteListRowProps {
  note: NoteListItem
  isActive: boolean
  inTrash: boolean
  /** Timestamp of the field the list is sorted by. */
  date: number
  onSelect: (id: string) => void
  onPin: (note: NoteListItem) => Promise<void>
  onDuplicate: (id: string) => Promise<void>
  onExport: (note: NoteListItem) => void
  onTrash: (note: NoteListItem) => Promise<void>
  onRestore: (note: NoteListItem) => Promise<void>
  onDelete: (note: NoteListItem) => Promise<void>
}

export function NoteListRow({
  note,
  isActive,
  inTrash,
  date,
  onSelect,
  onPin,
  onDuplicate,
  onExport,
  onTrash,
  onRestore,
  onDelete
}: NoteListRowProps): ReactNode {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'mb-1.5 w-full rounded-md px-3 py-3.5 text-left transition-colors',
            'hover:bg-accent focus:outline-none',
            isActive && 'bg-accent border-l-primary border-l-2'
          )}
          onClick={() => onSelect(note.id)}
        >
          <div className="mb-1 flex min-w-0 items-center gap-1.5">
            {note.isPinned && <PinIcon className="text-primary fill-primary size-3 shrink-0" />}
            <h3 className="flex-1 truncate text-sm font-medium text-pretty">
              {note.title || 'Untitled'}
            </h3>
          </div>
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <span className="shrink-0 whitespace-nowrap">{formatTimeAgo(date)}</span>
            {note.tags.length > 0 && (
              <>
                <span className="shrink-0 opacity-50">·</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: note.tags[0].color }}
                  />
                  <span className="truncate" title={note.tags[0].name}>
                    {note.tags[0].name}
                  </span>
                </span>
                {note.tags.length > 1 && (
                  <span
                    className="shrink-0"
                    title={note.tags
                      .slice(1)
                      .map((t) => t.name)
                      .join(', ')}
                  >
                    +{note.tags.length - 1}
                  </span>
                )}
              </>
            )}
          </div>
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {!inTrash ? (
          <>
            <ContextMenuItem onClick={() => void onPin(note)}>
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
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void onDuplicate(note.id)}>
              <CopyIcon className="size-4" />
              Duplicate
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onExport(note)}>
              <DownloadIcon className="size-4" />
              Export note…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => void onTrash(note)}>
              <Trash2Icon className="size-4" /> Move to trash
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={() => void onRestore(note)}>
              <RotateCcwIcon className="mr-2 h-4 w-4" /> Restore
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => void onDelete(note)}
              className="text-destructive focus:text-destructive"
            >
              <TrashIcon className="mr-2 h-4 w-4" /> Delete permanently
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
