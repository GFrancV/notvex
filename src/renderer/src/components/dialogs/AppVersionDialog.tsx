import { useEffect, useState, type ReactNode } from 'react'

import { FolderOpenIcon, Loader2Icon, TagIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { AppLogo } from '@/components/AppLogo'
import { BugReportActions } from '@/components/BugReportActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useIsDev } from '@/hooks/use-is-dev'
import { notvex } from '@/lib/ipc'

interface Props {
  open: boolean
  onClose: () => void
}

// A plain <a href> would navigate the window, which main blocks.
function ExternalLink({ url, children }: { url: string; children: ReactNode }): ReactNode {
  return (
    <Button
      variant="link"
      onClick={() => void notvex.shell.openExternal(url)}
      className="text-muted-foreground hover:text-foreground h-auto p-0 font-normal underline"
    >
      {children}
    </Button>
  )
}

export function AppVersionDialog({ open, onClose }: Props): ReactNode {
  const isDev = useIsDev()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [isCheckingLoading, setIsCheckingLoading] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  useEffect(() => {
    notvex.updater.getCurrentVersion().then((result) => {
      if (result.success) setAppVersion(result.data)
    })
  }, [])

  const handleCheckForUpdates = async (): Promise<void> => {
    setIsCheckingLoading(true)

    const result = await notvex.updater.checkNow()
    if (!result.success) {
      toast.error('Failed to check for updates')
    } else if (result.data === null) {
      toast.success("You're up to date")
    }

    setIsCheckingLoading(false)
  }

  // Clearing can't be undone, so the first click only arms the button.
  const handleClearLogs = async (): Promise<void> => {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    setConfirmingClear(false)
    const result = await notvex.log.clear()
    if (result.success) toast.success('Logs cleared')
    else toast.error("Couldn't clear the logs")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <div className="no-scrollbar max-h-[80vh] space-y-5 overflow-y-auto py-1">
          <section className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              <AppLogo />
              <div className="text-center">
                <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight">
                  Notvex
                  {isDev && <Badge variant="secondary">Dev</Badge>}
                </h1>
                <div className="text-muted mt-1">
                  {appVersion && (
                    <>
                      Version
                      <Badge variant="secondary" className="ml-2">
                        <TagIcon />v{appVersion}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Button disabled={isCheckingLoading} onClick={handleCheckForUpdates}>
                {isCheckingLoading ? (
                  <>
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  'Check for Update'
                )}
              </Button>
            </div>
          </section>
          <Separator />
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Troubleshooting</h2>
            <BugReportActions />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => void notvex.log.openFolder()}
              >
                <FolderOpenIcon />
                Open logs folder
              </Button>
              <Button
                variant={confirmingClear ? 'destructive' : 'ghost'}
                className="flex-1"
                onClick={handleClearLogs}
              >
                <Trash2Icon />
                {confirmingClear ? 'Confirm clear' : 'Clear logs'}
              </Button>
            </div>
          </section>
          <p className="text-muted-foreground flex justify-center text-sm">
            <ExternalLink url="https://github.com/GFrancV/notvex">Docs</ExternalLink>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
