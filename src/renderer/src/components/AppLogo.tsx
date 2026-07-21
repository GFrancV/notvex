import { ShieldIcon } from 'lucide-react'

import { useIsDev } from '@/hooks/use-is-dev'
import { cn } from '@/lib/utils'

export function AppLogo({ className }: { className?: string }): React.JSX.Element {
  const isDev = useIsDev()

  return (
    <div
      className={cn(
        'flex size-14 items-center justify-center rounded-xl border',
        isDev
          ? 'border-warning/20 bg-warning/15 shadow-[0_0_40px_-6px_oklch(0.769_0.188_70.08/0.5)]'
          : 'border-primary/20 bg-primary/15 shadow-[0_0_40px_-6px_oklch(0.701913_0.15768_160.4375/0.5)]',
        className
      )}
    >
      <ShieldIcon className={cn('size-1/2', isDev ? 'text-warning' : 'text-primary')} />
    </div>
  )
}
