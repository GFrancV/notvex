import type { ReactNode } from 'react'

import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { cn } from 'cn'

import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { Shortcut } from './Shortcut'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export function PrivacyModeToggle(): ReactNode {
  const { privacyMode, toggle } = usePrivacyMode()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A fixed label with aria-pressed: the label names the mode, the state says if it's on. */}
        <Button
          variant="ghost"
          size="xs"
          className={cn('titlebar-no-drag z-50', privacyMode && 'bg-accent text-primary')}
          aria-label="Privacy mode"
          aria-pressed={privacyMode}
          onClick={() => void toggle()}
        >
          {privacyMode ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Privacy mode <Shortcut keys="Mod-Shift-h" />
      </TooltipContent>
    </Tooltip>
  )
}
