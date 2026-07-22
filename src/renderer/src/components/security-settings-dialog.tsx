import { useEffect, useState, type ReactNode } from 'react'

import { KeyIcon, LockIcon, ShieldCheckIcon, ShieldOffIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { notvex } from '@/lib/ipc'
import { usePrefsStore } from '@/store/prefs.store'
import { ChangePasswordDialog } from './change-password-dialog'
import { KeyFileDialog } from './settings/KeyFileDialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'
import { Separator } from './ui/separator'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SecuritySettingsDialog({ open, onOpenChange }: Props): ReactNode {
  const { setPref } = usePrefsStore()
  const { autoLockMinutes, lockOnMinimize, allowScreenCapture } = usePrefsStore(
    useShallow((s) => ({
      autoLockMinutes: s.autoLockMinutes,
      lockOnMinimize: s.lockOnMinimize,
      allowScreenCapture: s.allowScreenCapture
    }))
  )

  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [keyFileDialogOpen, setKeyFileDialogOpen] = useState(false)
  const [hasKeyFile, setHasKeyFile] = useState(false)

  useEffect(() => {
    if (!open) return
    void notvex.vault.getHasKeyFile().then((r) => {
      setHasKeyFile(r.success ? r.data : false)
    })
  }, [open])

  const handleAutoLockChange = (minutes: string): void => {
    void setPref('autoLockMinutes', Number(minutes))
  }

  const handleLockOnMinimize = (checked: boolean): void => {
    void setPref('lockOnMinimize', checked)
  }

  const handleAllowScreenCapture = (checked: boolean): void => {
    void setPref('allowScreenCapture', checked)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              label="Timeout"
              description="Automatically lock the vault after a period of inactivity."
            >
              <Select value={String(autoLockMinutes)} onValueChange={handleAutoLockChange}>
                <SelectTrigger className="w-40" size="sm">
                  <SelectValue placeholder="Select a lock-out time" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="0">Never</SelectItem>
                    <SelectItem value="5">After 5 minutes</SelectItem>
                    <SelectItem value="15">After 15 minutes</SelectItem>
                    <SelectItem value="30">After 30 minutes</SelectItem>
                    <SelectItem value="60">After 1 hour</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow
              label="Lock when minimized"
              description="Lock the vault when the app window is minimized."
            >
              <Checkbox
                checked={lockOnMinimize}
                onCheckedChange={(v) => handleLockOnMinimize(v === true)}
              />
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

          {/* ── Authentication ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
              Authentication
            </p>
            <SettingRow
              label="Password"
              description="Change the password used to unlock this vault."
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onOpenChange(false)
                  setChangePasswordOpen(true)
                }}
              >
                <LockIcon />
                Change password
              </Button>
            </SettingRow>

            <SettingRow
              label="Key file"
              description={
                <span className="flex items-center gap-1.5">
                  {hasKeyFile ? (
                    <ShieldCheckIcon className="text-primary h-3.5 w-3.5" />
                  ) : (
                    <ShieldOffIcon className="h-3.5 w-3.5" />
                  )}
                  {hasKeyFile ? 'Configured' : 'Not configured'}
                </span>
              }
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onOpenChange(false)
                  setKeyFileDialogOpen(true)
                }}
              >
                <KeyIcon />
                Manage
              </Button>
            </SettingRow>
          </section>

          <Separator />

          {/* ── Always-on protections ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
              Always-on protections
            </p>
            <p className="text-muted-foreground text-xs">
              Notvex always locks the vault when the system sleeps or the screen locks, and applies
              a progressive delay after repeated failed unlock attempts. These protections are built
              in and cannot be turned off.
            </p>
          </section>
        </div>
      </DialogContent>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => {
          setChangePasswordOpen(false)
          onOpenChange(true)
        }}
      />
      <KeyFileDialog
        open={keyFileDialogOpen}
        onClose={() => {
          setKeyFileDialogOpen(false)
          onOpenChange(true)
        }}
        hasKeyFile={hasKeyFile}
        onHasKeyFileChange={setHasKeyFile}
      />
    </Dialog>
  )
}

function SettingRow({
  label,
  description,
  children
}: {
  label: string
  description?: ReactNode
  children: React.ReactNode
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 space-y-0.5">
        <p className="text-sm">{label}</p>
        {description && <div className="text-muted-foreground text-xs">{description}</div>}
      </div>
      <div className="mt-0.5 shrink-0">{children}</div>
    </div>
  )
}
