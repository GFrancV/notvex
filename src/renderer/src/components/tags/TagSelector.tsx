import { type ReactNode, useState } from 'react'

import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PRESET_COLORS } from '@/lib/tag-colors'
import { useVaultStore } from '@/store/vault.store'
import { type Tag, TAG_NAME_MAX } from '@shared/types'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '../ui/command'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover'

interface TagSelectorProps {
  noteId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The button that opens it. */
  children?: ReactNode
}

export function TagSelector({ noteId, open, onOpenChange, children }: TagSelectorProps): ReactNode {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-0">
        <AddTagList noteId={noteId} onDone={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  )
}

// Mounted only while the popover is open, so the search resets on every close.
function AddTagList({ noteId, onDone }: { noteId: string; onDone: () => void }): ReactNode {
  const { tags, noteTagsMap, addTagToNote, createTagAndAssign } = useVaultStore()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const assignedIds = new Set(noteTagsMap[noteId] ?? [])
  const available = tags.filter((t) => !assignedIds.has(t.id))
  const trimmed = search.trim()
  const showCreate =
    trimmed.length > 0 && !tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())

  const assignAndClose = async (action: () => Promise<unknown>, failure: string): Promise<void> => {
    setLoading(true)
    try {
      await action()
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : failure)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Command label="Search tags">
      <CommandInput
        maxLength={TAG_NAME_MAX}
        value={search}
        onValueChange={setSearch}
        placeholder="Search tags…"
      />
      <CommandList>
        {!showCreate && <CommandEmpty>No tags found</CommandEmpty>}
        <CommandGroup>
          {available.map((tag) => (
            <CommandItem
              key={tag.id}
              value={tag.name}
              disabled={loading}
              onSelect={() =>
                void assignAndClose(() => addTagToNote(noteId, tag.id), "Couldn't add the tag")
              }
            >
              <TagDot tag={tag} />
              {tag.name}
            </CommandItem>
          ))}
          {showCreate && (
            <CommandItem
              value={trimmed}
              disabled={loading}
              onSelect={() =>
                void assignAndClose(
                  () => createTagAndAssign(noteId, { name: trimmed, color: PRESET_COLORS[0] }),
                  "Couldn't create the tag"
                )
              }
            >
              <PlusIcon />
              Create &ldquo;{trimmed}&rdquo;
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

interface RemoveTagSelectorProps {
  tags: Tag[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemove: (tagId: string) => void
  /** What it opens next to; it only opens from the command palette. */
  children?: ReactNode
}

export function RemoveTagSelector({
  tags,
  open,
  onOpenChange,
  onRemove,
  children
}: RemoveTagSelectorProps): ReactNode {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align="start" className="w-52 p-0">
        <Command label="Remove tag">
          <CommandInput placeholder="Search tags…" />
          <CommandList>
            <CommandEmpty>No tags found</CommandEmpty>
            <CommandGroup>
              {tags.map((tag) => (
                <CommandItem key={tag.id} value={tag.name} onSelect={() => onRemove(tag.id)}>
                  <TagDot tag={tag} />
                  {tag.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function TagDot({ tag }: { tag: Tag }): ReactNode {
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
}
