import { useEffect, useState, type ReactNode } from 'react'

import { DotIcon, Loader2Icon, TagIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AppLogo } from '@/components/AppLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useIsDev } from '@/hooks/use-is-dev'
import { notvex } from '@/lib/ipc'

interface Props {
  open: boolean
  onClose: () => void
}

// A plain <a href> would navigate the window, which main blocks (#60).
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
          <ul className="text-muted-foreground mt-8 flex items-center justify-center gap-1 text-sm">
            <li>
              <ExternalLink url="https://github.com/GFrancV/notvex">Docs</ExternalLink>
            </li>
            <li>
              <DotIcon className="size-6" />
            </li>
            <li>
              <ExternalLink url="https://github.com/GFrancV/notvex/issues/new">
                Report Issue
              </ExternalLink>
            </li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
