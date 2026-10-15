import type { ReactNode } from 'react'

export function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return (
    <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
      {children}
    </p>
  )
}

export function SettingRow({
  label,
  description,
  children
}: {
  label: string
  description?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 space-y-0.5">
        <p className="text-sm">{label}</p>
        {description && <div className="text-muted-foreground text-xs">{description}</div>}
      </div>
      <div className="mt-0.5 shrink-0">{children}</div>
    </div>
  )
}
