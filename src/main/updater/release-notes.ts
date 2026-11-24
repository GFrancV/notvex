const OPEN = '<!-- in-app'
const CLOSE = '-->'
const SECURITY_MARKER = 'Security: yes'

export interface InAppNotes {
  summary: string
  security: boolean
}

export function parseInAppBlock(body: string): InAppNotes | null {
  const lines = body.split(/\r?\n/)
  const start = lines.indexOf(OPEN)
  if (start === -1) return null
  const end = lines.indexOf(CLOSE, start + 1)
  if (end === -1) return null
  const inner = lines.slice(start + 1, end)
  // a second opener before the close means the first block never closed
  if (inner.includes(OPEN)) return null
  return {
    summary: inner.filter((line) => line !== SECURITY_MARKER).join('\n'),
    security: inner.includes(SECURITY_MARKER)
  }
}
