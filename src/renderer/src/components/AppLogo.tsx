import { ShieldIcon } from 'lucide-react'
import { cn } from 'cn'

import { useIsDev } from '@/hooks/use-is-dev'

export function AppLogo({ className }: { className?: string }): React.JSX.Element {
  const isDev = useIsDev()

  return (
    <div
      className={cn(
        'flex size-14 items-center justify-center rounded-xl border',
        isDev
          ? 'border-warning/20 bg-warning/15 shadow-glow-warning'
          : 'border-primary/20 bg-primary/15 shadow-glow-primary',
        className
      )}
    >
      <ShieldIcon className={cn('size-1/2', isDev ? 'text-warning' : 'text-primary')} />
    </div>
  )
}
