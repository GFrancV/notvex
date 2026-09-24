import { useEffect, useState, type ReactNode } from 'react'

import { TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AppLogo } from '@/components/AppLogo'
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
import { truncatePath } from '@/lib/utils'

interface DevBuildWarningState {
  vaultPath: string
}

export function DevBuildWarningDialog(): ReactNode {
  const [state, setState] = useState<DevBuildWarningState | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    return notvex.vault.onDevBuildWarningRequired((data) => setState(data))
  }, [])

  const respond = async (confirmed: boolean): Promise<void> => {
    setLoading(true)
    try {
      const res = confirmed
        ? await notvex.vault.confirmDevBuildWarning()
        : await notvex.vault.cancelDevBuildWarning()
      if (!res.success) toast.error(res.error)
    } finally {
      setLoading(false)
      setState(null)
    }
  }

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(v) => {
        if (!v) void respond(false)
      }}
    >
      <DialogContent className="max-w-md" showCloseButton={false}>
        {state && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <AppLogo className="size-10 shrink-0" />
                <DialogTitle>Opening a real vault in a development build</DialogTitle>
              </div>
            </DialogHeader>
            <DialogDescription>
              <span className="text-foreground block truncate">
                {truncatePath(state.vaultPath)}
              </span>
              is a real vault, and this is a development build of Notvex. Opening it here could
              corrupt the vault or make its data irreversibly inaccessible.
            </DialogDescription>

            <div className="text-destructive bg-destructive/15 flex items-center gap-2 rounded-md px-3 py-2 text-sm">
              <TriangleAlertIcon className="size-4 shrink-0" />
              Only continue if you know what you&apos;re doing.
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                autoFocus
                disabled={loading}
                onClick={() => {
                  void respond(false)
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={loading}
                onClick={() => {
                  void respond(true)
                }}
              >
                Open anyway
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
