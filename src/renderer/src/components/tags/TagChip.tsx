import type { JSX } from 'react'

import type { Tag } from '@shared/types'

interface TagChipProps {
  tag: Tag
  onRemove?: () => void
}

export function TagChip({ tag, onRemove }: TagChipProps): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: tag.color + '26', color: tag.color }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 leading-none opacity-60 hover:opacity-100"
          title={`Remove tag ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  )
}
