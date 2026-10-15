import { useEffect, useState, type ReactNode } from 'react'

import {
  KeyIcon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon
} from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

const PANEL = 'min-h-0 space-y-5 overflow-y-auto py-1 pr-2'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: Props): ReactNode {
  const { setPref } = usePrefsStore()
  const {
    autoLockMinutes,
    lockOnMinimize,
    allowScreenCapture,
    clipboardClearSeconds,
    checkUpdatesOnStartup
  } = usePrefsStore(
    useShallow((s) => ({
      autoLockMinutes: s.autoLockMinutes,
      lockOnMinimize: s.lockOnMinimize,
      allowScreenCapture: s.allowScreenCapture,
      clipboardClearSeconds: s.clipboardClearSeconds,
      checkUpdatesOnStartup: s.checkUpdatesOnStartup
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

  const handleClipboardClearChange = (seconds: string): void => {
    void setPref('clipboardClearSeconds', Number(seconds))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed size keeps the tab list still while switching between short and long panels. */}
      <DialogContent className="flex h-[min(640px,85vh)] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* DialogContent unmounts on close, so every open starts on defaultValue. */}
        <Tabs defaultValue="security" orientation="vertical" className="min-h-0 flex-1 gap-6">
          <TabsList aria-label="Settings sections" variant="line" className="w-44 shrink-0">
            <TabsTrigger value="security">
              <ShieldIcon />
              Security
            </TabsTrigger>
            <TabsTrigger value="updates">
              <RefreshCwIcon />
              Updates
            </TabsTrigger>
          </TabsList>

          {/* Scrolls only past the fixed height, e.g. at high zoom; at the default size it fits. */}
          <TabsContent value="security" className={PANEL}>
            {/* ── Auto-lock ── */}
            <section className="space-y-3">
              <SectionTitle>Auto-lock</SectionTitle>

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
                  aria-label="Lock when minimized"
                  checked={lockOnMinimize}
                  onCheckedChange={(v) => handleLockOnMinimize(v === true)}
                />
              </SettingRow>
            </section>

            <Separator />

            {/* ── Clipboard ── */}
            <section className="space-y-3">
              <SectionTitle>Clipboard</SectionTitle>

              <SettingRow
                label="Auto-clear"
                description="Automatically clear the clipboard after copying text from the note editor."
              >
                <Select
                  value={String(clipboardClearSeconds)}
                  onValueChange={handleClipboardClearChange}
                >
                  <SelectTrigger className="w-40" size="sm">
                    <SelectValue placeholder="Select a duration" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      <SelectItem value="0">Never</SelectItem>
                      <SelectItem value="10">After 10 seconds</SelectItem>
                      <SelectItem value="30">After 30 seconds</SelectItem>
                      <SelectItem value="60">After 1 minute</SelectItem>
                      <SelectItem value="120">After 2 minutes</SelectItem>
                      <SelectItem value="300">After 5 minutes</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </SettingRow>
            </section>

            <Separator />

            {/* ── Privacy ── */}
            <section className="space-y-3">
              <SectionTitle>Privacy</SectionTitle>

              <SettingRow
                label="Prevent screen capture"
                description="Hides Notvex from screenshots and screen sharing. Requires restart."
              >
                <Checkbox
                  aria-label="Prevent screen capture"
                  checked={!allowScreenCapture}
                  onCheckedChange={(v) => handleAllowScreenCapture(!(v === true))}
                />
              </SettingRow>
            </section>

            <Separator />

            {/* ── Authentication ── */}
            <section className="space-y-3">
              <SectionTitle>Authentication</SectionTitle>
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
              <SectionTitle>Always-on protections</SectionTitle>
              <p className="text-muted-foreground text-xs">
                Notvex always locks the vault when the system sleeps or the screen locks, and
                applies a progressive delay after repeated failed unlock attempts. These protections
                are built in and cannot be turned off.
              </p>
            </section>
          </TabsContent>

          <TabsContent value="updates" className={PANEL}>
            <section className="space-y-3">
              <SectionTitle>Updates</SectionTitle>

              <SettingRow
                label="Check for updates on startup"
                description="Contacts GitHub when Notvex starts. GitHub sees your IP address, OS and app version. You can still check manually from About."
              >
                <Checkbox
                  aria-label="Check for updates on startup"
                  checked={checkUpdatesOnStartup}
                  onCheckedChange={(v) => void setPref('checkUpdatesOnStartup', v === true)}
                />
              </SettingRow>
            </section>
          </TabsContent>
        </Tabs>
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

function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return (
    <p className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">
      {children}
    </p>
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
