import type { ReactNode } from 'react'

import { ArrowUpDownIcon } from 'lucide-react'

import { usePrefsStore } from '@/store/prefs.store'
import type { NoteSort, NoteSortField } from '@shared/types'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

const FIELDS: { value: NoteSortField; label: string }[] = [
  { value: 'updatedAt', label: 'Date modified' },
  { value: 'createdAt', label: 'Date created' },
  { value: 'title', label: 'Title' }
]

export function NoteSortMenu(): ReactNode {
  const noteSort = usePrefsStore((s) => s.noteSort)
  const setPref = usePrefsStore((s) => s.setPref)
  const [asc, desc] = noteSort.field === 'title' ? ['A–Z', 'Z–A'] : ['Oldest first', 'Newest first']

  const update = (patch: Partial<NoteSort>): void => {
    void setPref('noteSort', { ...noteSort, ...patch })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Sort notes"
          title="Sort notes"
          className="titlebar-no-drag text-muted-foreground z-50"
        >
          <ArrowUpDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={noteSort.field}
          // A new field starts in its natural direction: A–Z for titles, newest first for dates.
          onValueChange={(v) =>
            update({ field: v as NoteSortField, direction: v === 'title' ? 'asc' : 'desc' })
          }
        >
          {FIELDS.map((f) => (
            <DropdownMenuRadioItem key={f.value} value={f.value}>
              {f.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={noteSort.direction}
          onValueChange={(v) => update({ direction: v as NoteSort['direction'] })}
        >
          <DropdownMenuRadioItem value="asc">{asc}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">{desc}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
