import { Fragment, type JSX } from 'react'

import { XIcon } from 'lucide-react'

import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import { Button } from '../ui/button'
import { TagChip } from './TagChip'

// count comes from the note list so it matches the header after the title search is applied.
export function TagFilter({ count }: { count: number }): JSX.Element | null {
  const { activeTags, searchQuery, clearActiveTags, toggleActiveTag } = useUiStore()
  const tags = useVaultStore((s) => s.tags)

  if (activeTags.length === 0) return null

  const activeTagObjects = activeTags
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => t != null)
  const query = searchQuery.trim()

  return (
    <div className="flex items-center gap-1.5 px-4 py-3 text-xs">
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {activeTagObjects.map((tag, i) => (
          <Fragment key={tag.id}>
            {i > 0 && <span className="text-muted-foreground">and</span>}
            <TagChip tag={tag} onRemove={() => toggleActiveTag(tag.id, true)} />
          </Fragment>
        ))}
        {query && (
          <>
            <span className="text-muted-foreground">and</span>
            <span className="max-w-full truncate" title={query}>
              title contains &quot;{query}&quot;
            </span>
          </>
        )}
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
