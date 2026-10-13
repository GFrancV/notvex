// Pure Markdown export/import helpers: no fs or electron, so the handlers own all I/O.

export interface MarkdownNote {
  title: string
  content: string
  tags: string[]
}

const ILLEGAL_CHARS = /[<>:"/\\|?*]/g
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i
// APFS and ext4 cap a name at 255 bytes and NTFS at 255 UTF-16 units; 200 UTF-8 bytes
// fits all three with room left for the " (n).md" suffix.
const MAX_NAME_BYTES = 200

function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0)!
  return code < 0x20 || code === 0x7f
}

export function toSafeFilename(title: string): string {
  let name = ''
  let bytes = 0
  // for..of walks code points, so the cap never lands inside a surrogate pair.
  for (const raw of title.replace(ILLEGAL_CHARS, '_').trim()) {
    const ch = isControlChar(raw) ? '_' : raw
    bytes += Buffer.byteLength(ch, 'utf8')
    if (bytes > MAX_NAME_BYTES) break
    name += ch
  }
  // Windows drops trailing dots and spaces, which would break de-duplication.
  name = name.replace(/[. ]+$/, '')
  if (!name) return 'Untitled'
  return name.replace(WINDOWS_RESERVED, '$1_')
}

// `used` holds lowercased names: the macOS and Windows filesystems are case-insensitive.
export function dedupeName(base: string, used: Set<string>): string {
  let file = `${base}.md`
  for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base} (${n}).md`
  used.add(file.toLowerCase())
  return file
}

// Quote anything a YAML flow sequence would read as syntax rather than as a plain scalar.
const TAG_NEEDS_QUOTES = /^[\s\-?'&*!|>%@`{}]|[,[\]{}:#"]|\s$/

function yamlTag(tag: string): string {
  // A JSON string is a valid YAML double-quoted scalar.
  return tag === '' || TAG_NEEDS_QUOTES.test(tag) ? JSON.stringify(tag) : tag
}

export function serializeNote({ title, content, tags }: MarkdownNote): string {
  const heading = title.replace(/\s*[\r\n]+\s*/g, ' ').trim() || 'Untitled'
  const body = `# ${heading}\n\n${content.replace(/\r\n/g, '\n')}`
  if (tags.length === 0) return body
  return `---\ntags: [${tags.map(yamlTag).join(', ')}]\n---\n${body}`
}

// ─── Parsing ─────────────────────────────────────────────────────────────────
// Not a YAML parser: it reads `title` and `tags` in the forms Obsidian and serializeNote
// write, and ignores every other line, so real-world front matter never blocks an import.

function parseScalar(raw: string): string | undefined {
  const s = raw.trim()
  if (s.startsWith('"')) {
    try {
      const value: unknown = JSON.parse(s)
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }
  if (s.startsWith("'")) {
    return s.length >= 2 && s.endsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : undefined
  }
  return s.replace(/\s+#.*$/, '')
}

function parseFlowList(raw: string): string[] | undefined {
  const s = raw.trim()
  if (!s.startsWith('[') || !s.endsWith(']')) return undefined
  const items: string[] = []
  let current = ''
  let quote = ''
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i]
    if (quote === '"' && ch === '\\') {
      current += ch + s[++i]
      continue
    }
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    }
    if (ch === ',' && !quote) {
      items.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  items.push(current)
  return items.map(parseScalar).filter((t): t is string => !!t)
}

function parseFrontMatter(lines: string[]): { title?: string; tags?: string[] } {
  const meta: { title?: string; tags?: string[] } = {}
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(lines[i])
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = (match[2] ?? '').trim()
    if (key === 'title') {
      meta.title = parseScalar(value)?.trim()
    } else if (key === 'tags' && value === '') {
      const tags: string[] = []
      while (i + 1 < lines.length) {
        const item = /^\s*-[ \t]+(.*)$/.exec(lines[i + 1])
        if (!item) break
        const tag = parseScalar(item[1])
        if (tag) tags.push(tag)
        i++
      }
      meta.tags = tags
    } else if (key === 'tags' && value.startsWith('[')) {
      meta.tags = parseFlowList(value)
    } else if (key === 'tags') {
      const tag = parseScalar(value)
      meta.tags = tag ? [tag] : []
    }
  }
  return meta
}

export function parseMarkdownFile(text: string, filename: string): MarkdownNote {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = withoutBom.replace(/\r\n?/g, '\n').split('\n')
  let meta: { title?: string; tags?: string[] } = {}
  let body = lines
  if (lines[0].trimEnd() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line))
    if (end > 0) {
      meta = parseFrontMatter(lines.slice(1, end))
      body = lines.slice(end + 1)
    }
  }

  let title = meta.title
  if (!title) {
    const first = body.findIndex((line) => line.trim() !== '')
    const heading = first >= 0 ? /^#[ \t]+(.*\S)\s*$/.exec(body[first]) : null
    if (heading) {
      title = heading[1]
      // serializeNote writes "# title" plus a blank line; dropping both keeps a round trip exact.
      body = body.slice(body[first + 1] === '' ? first + 2 : first + 1)
    }
  }

  return {
    title: title || filename.replace(/\.[^.]*$/, '').trim() || 'Untitled',
    content: body.join('\n'),
    tags: meta.tags ?? []
  }
}
