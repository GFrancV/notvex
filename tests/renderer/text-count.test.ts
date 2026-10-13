import { describe, expect, it } from 'vitest'

import { countText, formatCount } from '@/lib/text-count'

describe('countText', () => {
  it('counts nothing in an empty or whitespace-only note', () => {
    expect(countText('')).toEqual({ words: 0, chars: 0 })
    expect(countText('  \n\t ')).toEqual({ words: 0, chars: 5 })
  })

  it('splits words on any whitespace run, including newlines', () => {
    expect(countText('one  two\nthree\n\n  four ')).toEqual({ words: 4, chars: 23 })
  })

  it('counts markdown syntax as written', () => {
    expect(countText('# Title **bold**')).toEqual({ words: 3, chars: 16 })
  })

  it('counts an astral emoji as one character, not two UTF-16 units', () => {
    expect(countText('hi 😀')).toEqual({ words: 2, chars: 4 })
  })
})

describe('formatCount', () => {
  it('uses en-US grouping regardless of the OS locale', () => {
    expect(formatCount(1234567, 'word', 'words')).toBe('1,234,567 words')
  })

  it('uses the singular only for exactly one', () => {
    expect(formatCount(1, 'word', 'words')).toBe('1 word')
    expect(formatCount(0, 'word', 'words')).toBe('0 words')
  })
})
