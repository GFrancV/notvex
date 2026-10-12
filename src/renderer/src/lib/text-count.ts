export interface TextCount {
  words: number
  chars: number
}

// Pinned to en-US so the separator doesn't follow the OS locale; built once because
// constructing an Intl.NumberFormat is far costlier than formatting with one.
const countFormat = new Intl.NumberFormat('en-US')

/** Characters are code points, so an astral emoji counts once rather than as two UTF-16 units. */
export function countText(content: string): TextCount {
  const trimmed = content.trim()
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: [...content].length
  }
}

/** `1,234 words`, `1 word`. */
export function formatCount(n: number, singular: string, plural: string): string {
  return `${countFormat.format(n)} ${n === 1 ? singular : plural}`
}
