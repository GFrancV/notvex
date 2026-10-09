import { describe, expect, it } from 'vitest'

import { sortNotes } from '@/lib/sort-notes'
import type { NoteListItem } from '@shared/types'

function note(id: string, over: Partial<NoteListItem> = {}): NoteListItem {
  return {
    id,
    title: id,
    isPinned: false,
    isTrashed: false,
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
    tags: [],
    ...over
  }
}

const ids = (notes: NoteListItem[]): string[] => notes.map((n) => n.id)

describe('sortNotes', () => {
  const dated = [
    note('a', { createdAt: 3, updatedAt: 1 }),
    note('b', { createdAt: 1, updatedAt: 3 }),
    note('c', { createdAt: 2, updatedAt: 2 })
  ]

  it.each([
    ['updatedAt', 'desc', ['b', 'c', 'a']],
    ['updatedAt', 'asc', ['a', 'c', 'b']],
    ['createdAt', 'desc', ['a', 'c', 'b']],
    ['createdAt', 'asc', ['b', 'c', 'a']]
  ] as const)('sorts by %s %s', (field, direction, expected) => {
    expect(ids(sortNotes(dated, { field, direction }))).toEqual(expected)
  })

  it('sorts titles case-insensitively and numerically', () => {
    const notes = [
      note('1', { title: 'note 10' }),
      note('2', { title: 'Note 2' }),
      note('3', { title: 'apple' })
    ]
    expect(ids(sortNotes(notes, { field: 'title', direction: 'asc' }))).toEqual(['3', '2', '1'])
    expect(ids(sortNotes(notes, { field: 'title', direction: 'desc' }))).toEqual(['1', '2', '3'])
  })

  it.each(['asc', 'desc'] as const)(
    'puts untitled notes last when sorting by title %s',
    (direction) => {
      const notes = [note('u', { title: '' }), note('b', { title: 'b' }), note('a', { title: 'a' })]
      expect(ids(sortNotes(notes, { field: 'title', direction })).at(-1)).toBe('u')
    }
  )

  it('keeps pinned notes first whatever the sort', () => {
    const notes = [
      note('old-pinned', { isPinned: true, updatedAt: 1 }),
      note('new', { updatedAt: 9 }),
      note('new-pinned', { isPinned: true, updatedAt: 5 })
    ]
    expect(ids(sortNotes(notes, { field: 'updatedAt', direction: 'desc' }))).toEqual([
      'new-pinned',
      'old-pinned',
      'new'
    ])
    expect(ids(sortNotes(notes, { field: 'updatedAt', direction: 'asc' }))).toEqual([
      'old-pinned',
      'new-pinned',
      'new'
    ])
  })

  it('breaks ties by most recently updated, then by id', () => {
    const notes = [
      note('z', { title: 'same', updatedAt: 1 }),
      note('y', { title: 'same', updatedAt: 1 }),
      note('x', { title: 'same', updatedAt: 2 })
    ]
    expect(ids(sortNotes(notes, { field: 'title', direction: 'asc' }))).toEqual(['x', 'y', 'z'])
  })

  it('does not mutate its input', () => {
    const input = [...dated]
    sortNotes(input, { field: 'createdAt', direction: 'asc' })
    expect(input).toEqual(dated)
  })
})
