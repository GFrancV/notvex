import { type JSX, useState } from 'react'

import { toast } from 'sonner'

import { useVaultStore } from '@/store/vault.store'
import type { Tag } from '@shared/types'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Field, FieldError, FieldLabel } from '../ui/field'
import { Input } from '../ui/input'

const PRESET_COLORS = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16'
]

interface TagCreateModalProps {
  open: boolean
  onClose: () => void
  editTag?: Tag | null
}

export function TagCreateModal({ open, onClose, editTag }: TagCreateModalProps): JSX.Element {
  const { tags, createTag, updateTag } = useVaultStore()
  const [name, setName] = useState(editTag?.name ?? '')
  const [color, setColor] = useState(editTag?.color ?? PRESET_COLORS[0])
  const [loading, setLoading] = useState(false)

  const isDuplicate =
    !loading &&
    tags.some(
      (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase() && t.id !== editTag?.id
    )

  const canSubmit = name.trim().length > 0 && !isDuplicate && !loading

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return
    setLoading(true)
    try {
      if (editTag) {
        await updateTag(editTag.id, { name: name.trim(), color })
        toast.success('Tag updated')
      } else {
        await createTag({ name: name.trim(), color })
        toast.success('Tag created')
      }
      setName('')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save tag')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editTag ? 'Edit tag' : 'New tag'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field data-invalid={isDuplicate}>
            <FieldLabel htmlFor="tag-name">Name</FieldLabel>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit()
              }}
              placeholder='e.g. "Work"'
              maxLength={32}
              className={isDuplicate ? 'border-destructive focus-visible:ring-destructive' : ''}
              autoFocus
              aria-invalid={isDuplicate}
            />
            {isDuplicate && <FieldError>A tag with this name already exists</FieldError>}
          </Field>

          <Field>
            <FieldLabel>Color</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full transition-all ${
                    color === c
                      ? 'ring-offset-background scale-110 ring-2 ring-white ring-offset-1'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={(): void => void handleSubmit()} disabled={!canSubmit}>
            {editTag ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
