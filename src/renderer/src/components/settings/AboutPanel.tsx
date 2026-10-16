import { useEffect, useState, type ReactNode } from 'react'

import { BookOpenIcon, BugIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AppLogo } from '@/components/AppLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useIsDev } from '@/hooks/use-is-dev'
import { DOCS_URL, openBugReport } from '@/lib/bug-report'
import { notvex } from '@/lib/ipc'
import { SectionTitle, SettingRow } from './SettingRow'

export function AboutPanel(): ReactNode {
  const isDev = useIsDev()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    notvex.updater.getCurrentVersion().then((result) => {
      if (result.success) setAppVersion(result.data)
    })
  }, [])

  const handleCheckForUpdates = async (): Promise<void> => {
    setChecking(true)

    const result = await notvex.updater.checkNow()
    if (!result.success) {
      toast.error('Failed to check for updates')
    } else if (result.data === null) {
      toast.success("You're up to date")
    }

    setChecking(false)
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <AppLogo className="size-10 rounded-lg" />
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Notvex
            {appVersion && <span className="text-muted-foreground text-sm">v{appVersion}</span>}
            {isDev && <Badge variant="secondary">Dev</Badge>}
          </h2>
          <p className="text-muted-foreground text-xs">Encrypted notes, fully local.</p>
        </div>
      </div>

      <Separator />

      <section className="space-y-3">
        <SectionTitle>Updates</SectionTitle>
        <SettingRow
          label={appVersion ? `Version ${appVersion}` : 'Version'}
          description="Asks GitHub whether a newer release exists."
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={checking}
            onClick={() => void handleCheckForUpdates()}
          >
            {checking ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        </SettingRow>
      </section>

      <Separator />

      {/* Buttons, not <a href>: a link would navigate the window, which main blocks. */}
      <section className="space-y-3">
        <SectionTitle>Help & feedback</SectionTitle>
        <SettingRow label="Documentation" description="Guides and answers on GitHub.">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void notvex.shell.openExternal(DOCS_URL)}
          >
            <BookOpenIcon />
            Open docs
          </Button>
        </SettingRow>
        <SettingRow
          label="Report an issue"
          description="Opens a prefilled GitHub issue. You review it before anything is sent."
        >
          <Button variant="secondary" size="sm" onClick={() => void openBugReport()}>
            <BugIcon />
            Report a bug…
          </Button>
        </SettingRow>
      </section>
    </>
  )
}
