import type { JSX } from 'react'

import { X } from 'lucide-react'

import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import { Button } from '../ui/button'

export function TagFilter(): JSX.Element | null {
  const { activeTags, clearActiveTags } = useUiStore()
  const { tags, notes, noteTagsMap } = useVaultStore()

  if (activeTags.length === 0) return null

  const activeTagObjects = activeTags
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => t != null)

  const count = notes.filter((n) =>
    activeTags.every((tagId) => (noteTagsMap[n.id] ?? []).includes(tagId))
  ).length

  return (
    <div className="border-border flex items-center gap-1.5 border-b px-3 py-2 text-xs">
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {activeTagObjects.map((tag) => (
          <span key={tag.id} className="flex items-center gap-1" style={{ color: tag.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
            {tag.name}
          </span>
        ))}
        <span className="text-muted">
          ({count} note{count === 1 ? '' : 's'})
        </span>
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={clearActiveTags}
        title="Clear tag filter"
        className="text-muted"
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}
