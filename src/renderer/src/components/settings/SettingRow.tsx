import type { ReactNode } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'

// A flow opened from a settings row replaces its panel instead of stacking another modal; the
// parent crumb names where Back goes rather than a generic "Back".
export function SubpageHeader({
  parent,
  title,
  onBack,
  backDisabled = false
}: {
  parent: string
  title: string
  onBack: () => void
  backDisabled?: boolean
}): ReactNode {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-base">
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Button
              variant="link"
              onClick={onBack}
              disabled={backDisabled}
              className="text-muted-foreground hover:text-foreground h-auto p-0 text-base font-normal"
            >
              {parent}
            </Button>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {/* A heading rather than BreadcrumbPage, so the subpage title is reachable by heading
              navigation like the dialog title it replaces. */}
          <h3 aria-current="page" className="text-foreground text-base font-semibold">
            {title}
          </h3>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function SettingsSection({
  title,
  children
}: {
  title: string
  children: ReactNode
}): ReactNode {
  return (
    <section className="space-y-3">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      {children}
    </section>
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
