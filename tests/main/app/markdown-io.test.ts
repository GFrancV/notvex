import { describe, expect, it } from 'vitest'

import { dedupeName, parseMarkdownFile, serializeNote, toSafeFilename } from '@main/markdown-io'

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

describe('parseMarkdownFile', () => {
  it('uses the filename as the title of a plain file', () => {
    expect(parseMarkdownFile('just text', 'shopping list.txt')).toEqual({
      title: 'shopping list',
      content: 'just text',
      tags: []
    })
  })

  it('takes the title from a leading heading and removes it with one blank line', () => {
    expect(parseMarkdownFile('# Groceries\n\nmilk\neggs', 'x.md')).toEqual({
      title: 'Groceries',
      content: 'milk\neggs',
      tags: []
    })
  })

  it('skips blank lines before the heading', () => {
    expect(parseMarkdownFile('\n\n# Title\nbody', 'x.md')).toMatchObject({
      title: 'Title',
      content: 'body'
    })
  })

  it('leaves a heading that is not the first line in the content', () => {
    const text = 'intro\n\n# Section'
    expect(parseMarkdownFile(text, 'notes.md')).toMatchObject({ title: 'notes', content: text })
  })

  it('does not treat a level-2 heading or a hashtag as the title', () => {
    expect(parseMarkdownFile('## Sub\nx', 'a.md').title).toBe('a')
    expect(parseMarkdownFile('#tag\nx', 'b.md').title).toBe('b')
  })

  it('prefers the front matter title and keeps the heading in the content', () => {
    expect(parseMarkdownFile('---\ntitle: From meta\n---\n# Heading\nbody', 'x.md')).toEqual({
      title: 'From meta',
      content: '# Heading\nbody',
      tags: []
    })
  })

  it('reads quoted front matter titles', () => {
    expect(parseMarkdownFile('---\ntitle: "A: b"\n---\n', 'x.md').title).toBe('A: b')
    expect(parseMarkdownFile("---\ntitle: 'It''s'\n---\n", 'x.md').title).toBe("It's")
  })

  it('falls back from an empty front matter title', () => {
    expect(parseMarkdownFile('---\ntitle: ""\n---\n# H\n', 'x.md').title).toBe('H')
  })

  it('reads inline tags, quoted or not', () => {
    const text = '---\ntags: [work, "a, b", \'q\', ideas]\n---\nbody'
    expect(parseMarkdownFile(text, 'x.md')).toMatchObject({
      tags: ['work', 'a, b', 'q', 'ideas'],
      content: 'body'
    })
  })

  it('reads block-list tags', () => {
    const text = '---\ntags:\n  - work\n  - "deep: focus"\n- ideas\ndate: 2026-01-01\n---\nbody'
    expect(parseMarkdownFile(text, 'x.md').tags).toEqual(['work', 'deep: focus', 'ideas'])
  })

  it('reads a single scalar tag', () => {
    expect(parseMarkdownFile('---\ntags: solo\n---\n', 'x.md').tags).toEqual(['solo'])
  })

  it('ignores keys and lines it does not understand', () => {
    const text = '---\naliases:\n  - other\ncreated: 2026-01-01\nnested:\n  a: 1\n---\nbody'
    expect(parseMarkdownFile(text, 'x.md')).toEqual({ title: 'x', content: 'body', tags: [] })
  })

  it('ignores a tags value it cannot parse', () => {
    expect(parseMarkdownFile('---\ntags: [a, b\n---\nbody', 'x.md').tags).toEqual([])
  })

  it('reads a quote inside an unquoted tag as part of the tag', () => {
    const text = '---\ntags: [it\'s, say"hi, b]\n---\n'
    expect(parseMarkdownFile(text, 'x.md').tags).toEqual(["it's", 'say"hi', 'b'])
  })

  it('treats front matter without a closing line as plain content', () => {
    const text = '---\ntags: [a]\nbody'
    expect(parseMarkdownFile(text, 'x.md')).toEqual({ title: 'x', content: text, tags: [] })
  })

  it('strips a BOM and normalizes CRLF', () => {
    const text = String.fromCharCode(0xfeff) + '---\r\ntags: [a]\r\n---\r\n# T\r\n\r\nl1\r\nl2'
    expect(parseMarkdownFile(text, 'x.md')).toEqual({ title: 'T', content: 'l1\nl2', tags: ['a'] })
  })

  it('names a file with no usable name Untitled', () => {
    expect(parseMarkdownFile('x', '.md').title).toBe('Untitled')
  })

  it.each([
    { title: 'Plain', content: 'Body\nline 2', tags: [] },
    { title: 'Tagged', content: '', tags: ['work', 'ideas'] },
    {
      title: 'C# notes',
      content: '\n\nstarts blank',
      tags: ['a, b', '[x]', 'k: v', '#h', 'say "hi"', ' pad ', "'q", '-d']
    },
    { title: 'Rule', content: '---\nnot front matter\n---', tags: [] },
    { title: 'Heading body', content: '# Not the title\ntext', tags: ['t'] },
    { title: 'Apostrophe', content: '', tags: ["John's", 'work'] }
  ])('round-trips $title through serializeNote', (note) => {
    expect(parseMarkdownFile(serializeNote(note), 'ignored.md')).toEqual(note)
  })
})
