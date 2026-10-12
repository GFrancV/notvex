import { describe, expect, it } from 'vitest'

import { dedupeName, serializeNote, toSafeFilename } from '@main/markdown-io'

describe('toSafeFilename', () => {
  it('keeps an ordinary title unchanged', () => {
    expect(toSafeFilename('Meeting notes 2026')).toBe('Meeting notes 2026')
  })

  it('replaces characters that are illegal on Windows', () => {
    expect(toSafeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('replaces control characters', () => {
    expect(toSafeFilename('line\nbreak\ttab\x00nul\x7f')).toBe('line_break_tab_nul_')
  })

  it('strips trailing dots and spaces, which Windows silently drops', () => {
    expect(toSafeFilename('draft. . ')).toBe('draft')
  })

  it.each(['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9'])(
    'suffixes the Windows reserved name %s',
    (name) => {
      expect(toSafeFilename(name)).toBe(`${name}_`)
    }
  )

  it('treats a reserved name followed by an extension as reserved', () => {
    expect(toSafeFilename('con.md')).toBe('con_.md')
  })

  it('leaves names that only start like a reserved name alone', () => {
    expect(toSafeFilename('CONTRACT')).toBe('CONTRACT')
    expect(toSafeFilename('COM10')).toBe('COM10')
  })

  it.each(['', '   ', '...', '. .'])('falls back to Untitled for %j', (title) => {
    expect(toSafeFilename(title)).toBe('Untitled')
  })

  it('caps a long title at 200 UTF-8 bytes', () => {
    const name = toSafeFilename('a'.repeat(300))
    expect(name).toBe('a'.repeat(200))
  })

  it('never splits a multi-byte character at the cap', () => {
    const name = toSafeFilename('a' + '😀'.repeat(100))
    expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(200)
    expect(name).toBe('a' + '😀'.repeat(49))
    expect(name).not.toContain('�')
  })

  it('strips a trailing space exposed by the cap', () => {
    expect(toSafeFilename('a'.repeat(199) + ' tail')).toBe('a'.repeat(199))
  })
})

describe('dedupeName', () => {
  it('returns the plain name the first time and records it', () => {
    const used = new Set<string>()
    expect(dedupeName('Title', used)).toBe('Title.md')
    expect(used.has('title.md')).toBe(true)
  })

  it('numbers later collisions from 2', () => {
    const used = new Set<string>()
    expect(dedupeName('Title', used)).toBe('Title.md')
    expect(dedupeName('Title', used)).toBe('Title (2).md')
    expect(dedupeName('Title', used)).toBe('Title (3).md')
  })

  it('compares case-insensitively, like the macOS and Windows filesystems', () => {
    const used = new Set<string>()
    dedupeName('title', used)
    expect(dedupeName('TITLE', used)).toBe('TITLE (2).md')
  })

  it('skips a numbered name that is already taken', () => {
    const used = new Set(['title.md', 'title (2).md'])
    expect(dedupeName('Title', used)).toBe('Title (3).md')
  })
})

describe('serializeNote', () => {
  it('writes the title as a heading followed by the content', () => {
    expect(serializeNote({ title: 'Hello', content: 'Body text', tags: [] })).toBe(
      '# Hello\n\nBody text'
    )
  })

  it('omits the front matter when the note has no tags', () => {
    expect(serializeNote({ title: 'Hello', content: '', tags: [] })).not.toContain('---')
  })

  it('writes tags as YAML front matter', () => {
    expect(serializeNote({ title: 'Hello', content: 'Body', tags: ['work', 'ideas'] })).toBe(
      '---\ntags: [work, ideas]\n---\n# Hello\n\nBody'
    )
  })

  it('quotes tags that would otherwise break the YAML list', () => {
    const out = serializeNote({
      title: 'T',
      content: '',
      tags: ['a, b', '[x]', 'k: v', '#hash', 'say "hi"', ' padded ', '-dash']
    })
    expect(out).toContain(
      'tags: ["a, b", "[x]", "k: v", "#hash", "say \\"hi\\"", " padded ", "-dash"]'
    )
  })

  it('exports an empty title as Untitled', () => {
    expect(serializeNote({ title: '', content: 'x', tags: [] })).toBe('# Untitled\n\nx')
  })

  it('keeps a title on one line', () => {
    expect(serializeNote({ title: 'two\r\nlines', content: '', tags: [] })).toBe('# two lines\n\n')
  })

  it('normalizes CRLF in the content to LF', () => {
    expect(serializeNote({ title: 'T', content: 'a\r\nb', tags: [] })).toBe('# T\n\na\nb')
  })
})
