import type { ReactNode } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'

// A flow opened from a settings row replaces its panel instead of stacking another modal; the
// parent crumb names where Back goes rather than a generic "Back".
export function SubpageHeader({
  parent,
  title,
  onBack
}: {
  parent: string
  title: string
  onBack: () => void
}): ReactNode {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-base">
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Button
              variant="link"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground h-auto p-0 text-base font-normal"
            >
              {parent}
            </Button>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="font-semibold">{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

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
