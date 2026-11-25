import type { ReactNode } from 'react'

import { XIcon } from 'lucide-react'

import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import type { Tag } from '@shared/types'
import { Masked } from '../Masked'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface TagChipProps {
  tag: Tag
  onRemove?: () => void
}

export function TagChip({ tag, onRemove }: TagChipProps): ReactNode {
  const { privacyMode } = usePrivacyMode()
  return (
    <span
      className="group inline-flex h-6.5 max-w-full min-w-0 items-center gap-1.5 rounded px-3 py-0.5 text-xs font-medium transition duration-300"
      style={{ backgroundColor: tag.color + '26', color: tag.color }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate">
            <Masked text={tag.name} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <Masked text={tag.name} />
        </TooltipContent>
      </Tooltip>
      {onRemove && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="inline-flex h-3 w-0 shrink-0 items-center justify-center overflow-hidden transition-all duration-300 ease-in-out group-hover:w-3"
              aria-label={privacyMode ? 'Remove hidden tag' : `Remove tag ${tag.name}`}
            >
              <XIcon className="size-3 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Remove tag <Masked text={tag.name} />
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}
