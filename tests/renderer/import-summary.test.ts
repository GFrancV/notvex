import { describe, expect, it } from 'vitest'

import { summarizeImport } from '@/lib/import-summary'

describe('summarizeImport', () => {
  it('reports a clean import with no details', () => {
    expect(summarizeImport({ imported: 3, skipped: [], droppedTags: [] })).toEqual({
      message: 'Imported 3 notes',
      details: []
    })
  })

  it('uses the singular for one note', () => {
    expect(summarizeImport({ imported: 1, skipped: [], droppedTags: [] }).message).toBe(
      'Imported 1 note'
    )
  })

  it('lists skipped files and dropped tags with their reason', () => {
    const summary = summarizeImport({
      imported: 1,
      skipped: [{ file: 'big.md', reason: 'larger than 5 MB' }],
      droppedTags: [
        { file: 'a.md', count: 1, reason: 'longer than 24 characters' },
        { file: 'b.md', count: 10, reason: 'over the 50-tag limit for one note' }
      ]
    })

    expect(summary.details).toEqual([
      'big.md: larger than 5 MB',
      'a.md: 1 tag ignored (longer than 24 characters)',
      'b.md: 10 tags ignored (over the 50-tag limit for one note)'
    ])
  })

  it('caps a long list and says how many more there are', () => {
    const skipped = Array.from({ length: 8 }, (_, i) => ({ file: `${i}.md`, reason: 'r' }))

    const { details } = summarizeImport({ imported: 0, skipped, droppedTags: [] })

    expect(details).toHaveLength(6)
    expect(details.slice(0, 5)).toEqual(['0.md: r', '1.md: r', '2.md: r', '3.md: r', '4.md: r'])
    expect(details[5]).toBe('…and 3 more')
  })
})
