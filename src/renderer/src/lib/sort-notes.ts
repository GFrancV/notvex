import type { NoteListItem, NoteSort } from '@shared/types'

function compareTitles(a: string, b: string, dir: number): number {
  // Untitled notes say nothing about their place in an alphabet, so they sink in both directions.
  if (!a || !b) return Number(!a) - Number(!b)
  return dir * a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function sortNotes(notes: NoteListItem[], sort: NoteSort): NoteListItem[] {
  const dir = sort.direction === 'asc' ? 1 : -1
  return [...notes].sort(
    (a, b) =>
      Number(b.isPinned) - Number(a.isPinned) ||
      (sort.field === 'title'
        ? compareTitles(a.title, b.title, dir)
        : sort.field === 'createdAt'
          ? dir * (a.createdAt - b.createdAt)
          : dir * (a.updatedAt - b.updatedAt)) ||
      b.updatedAt - a.updatedAt ||
      a.id.localeCompare(b.id)
  )
}
