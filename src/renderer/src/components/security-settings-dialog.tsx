import { type ReactNode } from 'react'

import { CheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { notvex } from '@/lib/ipc'
import { usePrefsStore } from '@/store/prefs.store'
import { KeyFileSetting } from './settings/KeyFileSetting'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Separator } from './ui/separator'

interface Props {
  open: boolean
  onClose: () => void
}

async function handleOpenBackupsFolder(): Promise<void> {
  const res = await notvex.vault.openBackupsFolder()
  if (!res.success) toast.error(res.error)
}

export function SecuritySettingsDialog({ open, onClose }: Props): ReactNode {
  const { setPref } = usePrefsStore()
  const { lockOnMinimize, allowScreenCapture } = usePrefsStore(
    useShallow((s) => ({
      lockOnMinimize: s.lockOnMinimize,
      allowScreenCapture: s.allowScreenCapture
    }))
  )

  const handleLockOnMinimize = (checked: boolean): void => {
    void setPref('lockOnMinimize', checked)
  }

  const handleAllowScreenCapture = (checked: boolean): void => {
    void setPref('allowScreenCapture', checked)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Security settings</DialogTitle>
        </DialogHeader>

        <div className="no-scrollbar max-h-[80vh] space-y-5 overflow-y-auto py-1">
          {/* ── Auto-lock ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
              Auto-lock
            </p>

            <SettingRow
              label="Lock when minimized"
              description="Lock the vault when the app window is minimized."
            >
              <Checkbox
                checked={lockOnMinimize}
                onCheckedChange={(v) => handleLockOnMinimize(v === true)}
              />
            </SettingRow>

            <SettingRow
              label="Lock on system sleep"
              description="Always active. Cannot be disabled."
              readonly
            >
              <ReadonlyCheck />
            </SettingRow>

            <SettingRow
              label="Lock on screen lock"
              description="Always active. Cannot be disabled."
              readonly
            >
              <ReadonlyCheck />
            </SettingRow>
          </section>

          <Separator />

          {/* ── Privacy ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
              Privacy
            </p>

            <SettingRow
              label="Prevent screen capture"
              description="Hides Notvex from screenshots and screen sharing. Requires restart."
            >
              <Checkbox
                checked={!allowScreenCapture}
                onCheckedChange={(v) => handleAllowScreenCapture(!(v === true))}
              />
            </SettingRow>
          </section>

          <Separator />

          {/* ── Key file ── */}
          <KeyFileSetting />

          <Separator />

          {/* ── Backups ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
              Backups
            </p>
            <p className="text-muted-foreground text-xs">
              Plain point-in-time copies of your vault file, created automatically before
              format-changing updates. Safe to delete — not a restore feature, just browsable via
              your file explorer.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleOpenBackupsFolder()
              }}
            >
              Open backups folder
            </Button>
          </section>

          <Separator />

          {/* ── Unlock attempts ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
              Unlock attempts
            </p>

            <SettingRow
              label="Progressive delay after failed unlock attempts"
              description="Always active. Cannot be disabled."
              readonly
            >
              <ReadonlyCheck />
            </SettingRow>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SettingRow({
  label,
  description,
  readonly = false,
  children
}: {
  label: string
  description?: string
  readonly?: boolean
  children: React.ReactNode
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 space-y-0.5">
        <p className={`text-sm ${readonly ? 'text-muted-foreground' : ''}`}>{label}</p>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className="mt-0.5 shrink-0">{children}</div>
    </div>
  )
}

function ReadonlyCheck(): ReactNode {
  return (
    <div className="bg-primary/20 border-primary/30 flex h-4 w-4 items-center justify-center rounded border">
      <CheckIcon className="text-primary h-3 w-3" />
    </div>
  )
}
