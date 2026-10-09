import type { NoteListItem, NoteSort } from '@shared/types'

function compareTitles(a: string, b: string, dir: number): number {
  // Untitled notes say nothing about their place in an alphabet, so they sink in both directions.
  if (!a || !b) return Number(!a) - Number(!b)
  return dir * a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
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
