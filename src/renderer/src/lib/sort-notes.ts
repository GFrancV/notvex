import type { NoteListItem, NoteSort } from '@shared/types'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// New notes are stored as 'Untitled' and a cleared title as '', but both read as untitled.
function isUntitled(title: string): boolean {
  const trimmed = title.trim()
  return trimmed === '' || trimmed === 'Untitled'
}

function compareTitles(a: string, b: string, dir: number): number {
  // Untitled notes say nothing about their place in an alphabet, so they sink in both directions.
  const aUntitled = isUntitled(a)
  const bUntitled = isUntitled(b)
  if (aUntitled || bUntitled) return Number(aUntitled) - Number(bUntitled)
  return dir * collator.compare(a, b)
}

function compareField(a: NoteListItem, b: NoteListItem, sort: NoteSort): number {
  const dir = sort.direction === 'asc' ? 1 : -1
  if (sort.field === 'title') return compareTitles(a.title, b.title, dir)
  if (sort.field === 'createdAt') return dir * (a.createdAt - b.createdAt)
  return dir * (a.updatedAt - b.updatedAt)
}

export function sortNotes(notes: NoteListItem[], sort: NoteSort): NoteListItem[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.isPinned) - Number(a.isPinned) ||
      compareField(a, b, sort) ||
      b.updatedAt - a.updatedAt ||
      a.id.localeCompare(b.id)
  )
}
