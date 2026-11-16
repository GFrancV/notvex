import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'

import DOMPurify from 'dompurify'
import { ExternalLinkIcon, ShieldAlertIcon, TagIcon, TriangleAlertIcon } from 'lucide-react'

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
import { formatFileSize } from '@/lib/utils'
import type { UpdateInfo } from '@shared/types'

type Phase =
  | { phase: 'available'; info: UpdateInfo }
  | { phase: 'downloading'; percent: number; transferred: number; total: number }
  | { phase: 'installing' }
  // retry: the failure came from the download, which can simply start again
  | { phase: 'error'; message: string; retry: boolean }

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

// The summary is short text: a remote image would only show as broken, since the CSP blocks it
const SUMMARY_DISALLOWED = ['img']

// The summary comes from the network: only https links stay clickable, anything else is text
const SUMMARY_COMPONENTS: Components = {
  a({ href, children }) {
    if (!href?.startsWith('https://')) return <>{children}</>
    return (
      <Button
        variant="link"
        className="h-fit gap-1 p-0 underline has-[>svg]:px-0"
        onClick={() => void notvex.shell.openExternal(href)}
      >
        {children} <span className="sr-only">(opens in your browser)</span>
        <ExternalLinkIcon aria-hidden className="size-3.5" />
      </Button>
    )
  }
}

// Quiet time before the dialog opens, so it never lands mid-typing
const IDLE_MS = 1500

// Fixed to en-US so the date matches the language of the rest of the UI
const RELEASE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })

function releaseMeta(info: UpdateInfo): string {
  const date = info.releaseDate
    ? `Released ${RELEASE_DATE_FORMAT.format(new Date(info.releaseDate))}`
    : null
  const size = info.size ? formatFileSize(info.size) : null
  return [date, size].filter(Boolean).join(' · ')
}

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
        setState({
          phase: 'downloading',
          percent: p.percent,
          transferred: p.transferred,
          total: p.total
        })
      ),
      notvex.updater.onUpdateDownloaded(() => {
        setState({ phase: 'installing' })
        void notvex.updater.installNow()
      }),
      notvex.updater.onError((err) =>
        setState((prev) =>
          prev === null
            ? prev
            : { phase: 'error', message: err.message, retry: prev.phase === 'downloading' }
        )
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
    setState({ phase: 'downloading', percent: 0, transferred: 0, total: 0 })
    void notvex.updater.download()
  }

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(v) => {
        if (!v && dismissible) {
          // Escape or a click outside; the footer buttons close by setting state instead
          if (state?.phase === 'available') void notvex.updater.dismiss(state.info.version)
          setState(null)
        }
      }}
    >
      <DialogContent
        className={
          state?.phase === 'available'
            ? 'flex max-h-[min(540px,85vh)] min-h-[360px] flex-col sm:max-w-xl'
            : undefined
        }
      >
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
                  {state.info.security && (
                    <Badge
                      variant="outline"
                      className="border-destructive/40 bg-destructive/10 text-destructive ml-2"
                    >
                      <ShieldAlertIcon />
                      Security fixes
                    </Badge>
                  )}
                </DialogTitle>
              </div>
              <DialogDescription>{releaseMeta(state.info)}</DialogDescription>
            </DialogHeader>
            {state.info.summary ? (
              <ScrollArea className="flex min-h-0 flex-1 flex-col [&>[data-slot=scroll-area-viewport]]:min-h-0">
                <div className="text-muted-foreground space-y-2 text-sm [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc">
                  <ReactMarkdown
                    disallowedElements={SUMMARY_DISALLOWED}
                    components={SUMMARY_COMPONENTS}
                  >
                    {state.info.summary}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
            ) : (
              releaseNotesHtml && (
                <ScrollArea className="flex min-h-0 flex-1 flex-col [&>[data-slot=scroll-area-viewport]]:min-h-0">
                  <div
                    className="text-muted-foreground [&_a]:text-primary space-y-2 text-sm [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc"
                    dangerouslySetInnerHTML={{ __html: releaseNotesHtml }}
                  />
                </ScrollArea>
              )
            )}
            <DialogFooter>
              <Button
                variant="link"
                className="mr-auto px-0 has-[>svg]:px-0"
                aria-label="Release notes (opens in your browser)"
                onClick={() => void notvex.shell.openExternal(state.info.releaseUrl)}
              >
                Release notes
                <ExternalLinkIcon aria-hidden />
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void notvex.updater.snooze(state.info.version)
                  setState(null)
                }}
              >
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
                {state.total > 0 && (
                  <span className="ml-auto">
                    {formatFileSize(state.transferred)} of {formatFileSize(state.total)}
                  </span>
                )}
                <span className={state.total > 0 ? undefined : 'ml-auto'}>{state.percent}%</span>
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
              {state.retry && <Button onClick={handleUpdateNow}>Retry</Button>}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
