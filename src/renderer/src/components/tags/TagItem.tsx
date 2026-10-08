import type React from 'react'

import { MoreHorizontalIcon, PenIcon, Trash2Icon } from 'lucide-react'

import type { Tag } from '@shared/types'
import { Checkbox } from '../ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import {
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from '../ui/sidebar'

interface TagItemProps {
  tag: Tag
  count: number
  active: boolean
  onClick: (e: React.MouseEvent) => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}

export function TagItem({
  tag,
  count,
  active,
  onClick,
  onToggle,
  onEdit,
  onDelete
}: TagItemProps): React.ReactNode {
  return (
    <SidebarMenuItem>
      {/* A sibling, not a child: Radix Checkbox is a <button>, and nested inside the row
          button its click would also fire the exclusive select. */}
      <Checkbox
        checked={active}
        onCheckedChange={onToggle}
        aria-label={`Filter by ${tag.name}`}
        className="absolute top-1/2 left-2 z-10 -translate-y-1/2 opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100"
      />
      <SidebarMenuButton isActive={active} onClick={onClick}>
        <span
          className="size-2 rounded-full group-focus-within/menu-item:invisible group-hover/menu-item:invisible"
          style={{ backgroundColor: tag.color }}
        />
        <span title={tag.name}>{tag.name}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover onClick={(e) => e.stopPropagation()}>
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onClick={onEdit}>
            <PenIcon className="size-4" />
            Edit tag
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon className="size-4" />
            Delete tag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {count > 0 && (
        <SidebarMenuBadge className="group-hover/menu-item:hidden">{count}</SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  )
}
