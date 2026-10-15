import { useEffect, useState, type ReactNode } from 'react'

import {
  DatabaseIcon,
  KeyIcon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { notvex } from '@/lib/ipc'
import { usePrefsStore } from '@/store/prefs.store'
import { ChangePasswordDialog } from './change-password-dialog'
import { ExportWarningDialog } from './dialogs/ExportWarningDialog'
import { KeyFileDialog } from './settings/KeyFileDialog'
import { SectionTitle, SettingRow } from './settings/SettingRow'
import { VaultDataPanel } from './settings/VaultDataPanel'
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

// The divider lives on the panel, which already spans the dialog's height; stretching the tab
// list instead would stretch every tab with it.
const PANEL = 'border-border min-h-0 space-y-5 overflow-y-auto border-l py-1 pr-2 pl-6'

// Active indicator on the left in the primary color; the same variant prefix as the shadcn
// classes lets tailwind-merge replace them instead of stacking on top.
const TAB =
  'pl-3 after:bg-primary group-data-[orientation=vertical]/tabs:after:right-auto group-data-[orientation=vertical]/tabs:after:left-0'

// The warning dialog stays open while this runs, but the OS folder dialog hides it; the
// toast is what reports progress and the result.
const handleExportAll = async (): Promise<void> => {
  const toastId = toast.loading('Exporting notes…')
  const result = await notvex.notes.exportAll()
  if (!result.success) {
    toast.error(result.error, { id: toastId })
  } else if (result.data === null) {
    toast.dismiss(toastId) // user canceled the folder dialog
  } else {
    const noun = result.data === 1 ? 'note' : 'notes'
    toast.success(`Exported ${result.data} ${noun}`, { id: toastId })
  }
}

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
  const [exportAllOpen, setExportAllOpen] = useState(false)

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
        <Tabs defaultValue="security" orientation="vertical" className="min-h-0 flex-1 gap-3">
          <TabsList aria-label="Settings sections" variant="line" className="w-44 shrink-0">
            <TabsTrigger value="security" className={TAB}>
              <ShieldIcon />
              Security
            </TabsTrigger>
            <TabsTrigger value="updates" className={TAB}>
              <RefreshCwIcon />
              Updates
            </TabsTrigger>
            <TabsTrigger value="vault" className={TAB}>
              <DatabaseIcon />
              Vault & Data
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

          <TabsContent value="vault" className={PANEL}>
            <VaultDataPanel onExportAll={() => setExportAllOpen(true)} />
          </TabsContent>
        </Tabs>

        {/* Confirmations render inside DialogContent: Radix decides "outside" by React tree, so a
            sibling dialog's clicks would count as outside this one and dismiss it. */}
        <ExportWarningDialog
          open={exportAllOpen}
          onOpenChange={setExportAllOpen}
          title="Export all notes"
          onConfirm={handleExportAll}
        />
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
