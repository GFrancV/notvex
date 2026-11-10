import { useEffect, useMemo, useState, type ReactNode } from 'react'

import DOMPurify from 'dompurify'
import { TagIcon, TriangleAlertIcon } from 'lucide-react'

import { AppLogo } from '@/components/AppLogo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

const RELEASE_NOTES_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'code', 'h1', 'h2', 'h3'],
  ALLOWED_ATTR: ['href']
}

// Release notes come from the GitHub API over the network — force external
// links to open via the OS browser (handled by setWindowOpenHandler in
// main/navigation-guard.ts) instead of navigating inside the app window.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// Quiet time before the dialog opens, so it never lands mid-typing
const IDLE_MS = 1500

interface UpdateAvailableDialogProps {
  // false while a password screen is up: the dialog would take keystrokes meant for it
  ready: boolean
}

export function UpdateAvailableDialog({ ready }: UpdateAvailableDialogProps): ReactNode {
  const [stored, setState] = useState<Phase | null>(null)
  const [idle, setIdle] = useState(false)
  // Leaving the notes view ends the quiet period: coming back must wait again
  if (!ready && idle) setIdle(false)
  const state = stored?.phase === 'available' && !(ready && idle) ? null : stored

  const releaseNotesHtml = useMemo(() => {
    const raw = state?.phase === 'available' ? state.info.releaseNotes : null
    return raw ? DOMPurify.sanitize(raw, RELEASE_NOTES_SANITIZE_CONFIG) : null
  }, [state])

  useEffect(() => {
    const offFns = [
      notvex.updater.onUpdateAvailable((info) => {
        setIdle(false)
        setState({ phase: 'available', info })
      }),
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

    void notvex.updater.checkOnStartup()

    return (): void => offFns.forEach((off) => off())
  }, [])

  const waiting = stored?.phase === 'available' && ready && !idle
  useEffect(() => {
    if (!waiting) return
    let timer: ReturnType<typeof setTimeout>
    const restart = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), IDLE_MS)
    }
    restart()
    // capture: a handler that stops propagation must not hide the input
    window.addEventListener('keydown', restart, true)
    window.addEventListener('pointerdown', restart, true)
    return (): void => {
      clearTimeout(timer)
      window.removeEventListener('keydown', restart, true)
      window.removeEventListener('pointerdown', restart, true)
    }
  }, [waiting])

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
      <DialogContent>
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
            {releaseNotesHtml && (
              <ScrollArea className="max-h-48">
                <div
                  className="text-muted-foreground [&_a]:text-primary space-y-2 text-sm [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc"
                  dangerouslySetInnerHTML={{ __html: releaseNotesHtml }}
                />
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
              <DialogTitle>Update failed</DialogTitle>
            </DialogHeader>
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <DialogDescription asChild>
                <AlertDescription>{state.message}</AlertDescription>
              </DialogDescription>
            </Alert>
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
