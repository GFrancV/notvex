import { type ReactNode, useState } from 'react'

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
import { notvex } from '@/lib/ipc'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ClearLogsDialog({ open, onOpenChange }: Props): ReactNode {
  const [clearing, setClearing] = useState(false)

  // The invoke itself can reject, not just return a failure; the dialog must stay closable.
  const confirm = async (): Promise<void> => {
    setClearing(true)
    const cleared = await notvex.log
      .clear()
      .then((result) => result.success)
      .catch(() => false)
    setClearing(false)
    onOpenChange(false)
    if (cleared) toast.success('Logs cleared')
    else toast.error("Couldn't clear the logs")
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !clearing && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear error logs?</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          This deletes the local error log. It can&apos;t be undone, and a later bug report
          won&apos;t include the errors recorded so far.
        </DialogDescription>
        <DialogFooter>
          <Button variant="ghost" autoFocus disabled={clearing} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={clearing} onClick={() => void confirm()}>
            Clear logs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
