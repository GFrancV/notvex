import { useEffect, useState, type ReactNode } from 'react'

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
import { reloadWindow, requestReload } from '@/lib/reload-window'
import { useUiStore } from '@/store/ui.store'

// Mounted in App for every view, so the menu accelerator works on Unlock and Setup too.
export function ReloadWindowDialog(): ReactNode {
  const { reloadConfirmOpen, setReloadConfirmOpen } = useUiStore()
  const [loading, setLoading] = useState(false)

  useEffect(() => notvex.onReloadRequested(() => void requestReload()), [])

  const confirm = async (): Promise<void> => {
    setLoading(true)
    try {
      await reloadWindow()
    } finally {
      setLoading(false)
      setReloadConfirmOpen(false)
    }
  }

  return (
    <Dialog open={reloadConfirmOpen} onOpenChange={(v) => !loading && setReloadConfirmOpen(v)}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reload window?</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Reloading will lock your vault. Unsaved changes are saved first, and you&apos;ll need your
          password (or recovery key) to unlock it again.
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="ghost"
            autoFocus
            disabled={loading}
            onClick={() => setReloadConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={loading}
            onClick={() => {
              void confirm()
            }}
          >
            Reload and lock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
