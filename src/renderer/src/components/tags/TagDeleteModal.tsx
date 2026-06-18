import { type ReactNode, useState } from 'react'

import { toast } from 'sonner'

import type { Tag } from '@shared/types'
import { useUiStore } from '../../store/ui.store'
import { useVaultStore } from '../../store/vault.store'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'

interface TagDeleteModalProps {
  open: boolean
  onClose: () => void
  tag: Tag | null
}

export function TagDeleteModal({ open, onClose, tag }: TagDeleteModalProps): ReactNode {
  const { tagCounts, deleteTag } = useVaultStore()
  const { activeTags, clearActiveTags } = useUiStore()
  const [loading, setLoading] = useState(false)

  const count = tag ? (tagCounts[tag.id] ?? 0) : 0

  const handleConfirm = async (): Promise<void> => {
    if (!tag) return
    setLoading(true)
    try {
      await deleteTag(tag.id)
      if (activeTags.includes(tag.id)) clearActiveTags()
      toast.success('Tag deleted')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete tag')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="border-b-0">
          <DialogTitle>Delete &ldquo;{tag?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            {count > 0
              ? `This will remove the tag from ${count} note${count === 1 ? '' : 's'}. The notes themselves won't be deleted.`
              : 'This tag has no notes.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={(): void => void handleConfirm()}
            disabled={loading}
          >
            Delete tag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
