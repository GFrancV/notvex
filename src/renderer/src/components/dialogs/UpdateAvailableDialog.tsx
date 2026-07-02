import { useEffect, useState, type ReactNode } from 'react'

import { TagIcon, TriangleAlertIcon } from 'lucide-react'

import { AppLogo } from '@/components/AppLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { notvex } from '@/lib/ipc'
import type { UpdateInfo } from '@shared/types'

type Phase =
  | { phase: 'available'; info: UpdateInfo }
  | { phase: 'downloading'; percent: number }
  | { phase: 'installing' }
  | { phase: 'error'; message: string }

export function UpdateAvailableDialog(): ReactNode {
  const [state, setState] = useState<Phase | null>(null)

  useEffect(() => {
    const offFns = [
      notvex.updater.onUpdateAvailable((info) => setState({ phase: 'available', info })),
      notvex.updater.onDownloadProgress((p) =>
        setState({ phase: 'downloading', percent: p.percent })
      ),
      notvex.updater.onUpdateDownloaded(() => {
        setState({ phase: 'installing' })
        void notvex.updater.installNow()
      }),
      notvex.updater.onError((err) =>
        setState((prev) => (prev === null ? prev : { phase: 'error', message: err.message }))
      )
    ]

    void notvex.updater.checkNow()

    return (): void => offFns.forEach((off) => off())
  }, [])

  const dismissible = state?.phase === 'available' || state?.phase === 'error'

  const handleUpdateNow = (): void => {
    setState({ phase: 'downloading', percent: 0 })
    void notvex.updater.download()
  }

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(v) => {
        if (!v && dismissible) setState(null)
      }}
    >
      <DialogContent className="max-w-md" showCloseButton={dismissible}>
        {state?.phase === 'available' && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <AppLogo className="size-10 shrink-0" />
                <DialogTitle>
                  Update available
                  <Badge variant="secondary" className="ml-2">
                    <TagIcon />v{state.info.version}
                  </Badge>
                </DialogTitle>
              </div>
            </DialogHeader>
            {state.info.releaseNotes && (
              <ScrollArea className="max-h-48">
                <p className="text-muted-foreground text-sm whitespace-pre-line">
                  {state.info.releaseNotes}
                </p>
              </ScrollArea>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setState(null)}>
                Remind me later
              </Button>
              <Button onClick={handleUpdateNow}>Update now</Button>
            </DialogFooter>
          </>
        )}

        {state?.phase === 'downloading' && (
          <>
            <DialogHeader>
              <DialogTitle>Downloading update… </DialogTitle>
            </DialogHeader>

            <Field className="text-muted-foreground w-full">
              <FieldLabel htmlFor="progress-download">
                <span>Download progress</span>
                <span className="ml-auto">{state.percent}%</span>
              </FieldLabel>
              <Progress value={state.percent} id="progress-download" />
            </Field>
          </>
        )}

        {state?.phase === 'installing' && (
          <>
            <DialogHeader>
              <DialogTitle>Installing update…</DialogTitle>
            </DialogHeader>
            <Field className="text-muted-foreground w-full">
              <FieldLabel htmlFor="installing">
                <span>Notvex will restart automatically</span>
              </FieldLabel>
              <Progress value={100} id="installing" />
            </Field>
          </>
        )}

        {state?.phase === 'error' && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="border-destructive/20 bg-destructive/15 flex size-10 shrink-0 items-center justify-center rounded-xl border">
                  <TriangleAlertIcon className="text-destructive size-1/2" />
                </div>
                <DialogTitle className="text-destructive">Update failed</DialogTitle>
              </div>
            </DialogHeader>
            <p className="text-muted-foreground text-sm">{state.message}</p>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setState(null)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
