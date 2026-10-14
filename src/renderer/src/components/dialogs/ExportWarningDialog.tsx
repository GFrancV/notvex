import { useState, type ReactNode } from 'react'

import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { flushAllPending } from '@/lib/pending-save'

interface ExportWarningDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Runs the export IPC call and reports its result. */
  onConfirm: () => Promise<void>
}

// Shown before every export, with no "don't ask again": each export puts plaintext on disk.
export function ExportWarningDialog({
  open,
  onOpenChange,
  title,
  onConfirm
}: ExportWarningDialogProps): ReactNode {
  const [busy, setBusy] = useState(false)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      // Main reads notes from the vault, so edits still inside the autosave debounce go first.
      // If they can't be saved, exporting would write an older version than the one on screen.
      try {
        await flushAllPending()
      } catch {
        toast.error('Your latest edits could not be saved, so nothing was exported')
        return
      }
      await onConfirm()
    } finally {
      setBusy(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Exported files are not encrypted. Anyone with access to the folder you save them in can
          read them.
        </DialogDescription>
        <DialogFooter>
          <Button variant="ghost" autoFocus disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void confirm()
            }}
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
