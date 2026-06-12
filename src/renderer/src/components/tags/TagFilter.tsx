import type { JSX } from 'react'

import { XIcon } from 'lucide-react'

import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import { Button } from '../ui/button'
import { TagChip } from './TagChip'

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
    <div className="flex items-center gap-1.5 px-4 py-3 text-xs">
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {activeTagObjects.map((tag) => (
          <TagChip key={tag.id} tag={tag} />
        ))}
        <span className="text-muted-foreground">
          ({count} note{count === 1 ? '' : 's'})
        </span>
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={clearActiveTags}
        title="Clear tag filter"
        className="text-muted-foreground"
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  )
}
