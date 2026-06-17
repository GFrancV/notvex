import { ShieldIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export function AppLogo({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'border-primary/20 bg-primary/15 flex size-14 items-center justify-center rounded-xl border shadow-[0_0_40px_-6px_oklch(0.701913_0.15768_160.4375/0.5)]',
        className
      )}
    >
      <ShieldIcon className="text-primary size-1/2" />
    </div>
  )
}
