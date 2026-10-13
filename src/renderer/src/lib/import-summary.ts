import type { ImportResult } from '@shared/types'

// A toast can't scroll, so a long list is cut short with a count of what's left.
const MAX_DETAILS = 5

export function summarizeImport(result: ImportResult): { message: string; details: string[] } {
  const noun = result.imported === 1 ? 'note' : 'notes'
  const all = [
    ...result.skipped.map((s) => `${s.file}: ${s.reason}`),
    ...result.droppedTags.map((d) => {
      const tags = d.count === 1 ? 'tag' : 'tags'
      return `${d.file}: ${d.count} ${tags} ignored (${d.reason})`
    })
  ]
  const details =
    all.length > MAX_DETAILS
      ? [...all.slice(0, MAX_DETAILS), `…and ${all.length - MAX_DETAILS} more`]
      : all
  return { message: `Imported ${result.imported} ${noun}`, details }
}
