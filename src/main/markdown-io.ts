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
