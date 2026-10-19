import { useEffect, useState, type ReactNode } from 'react'

import {
  FileKeyIcon,
  FolderOpenIcon,
  LockIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  Trash2Icon
} from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { notvex } from '@/lib/ipc'
import { usePrefsStore } from '@/store/prefs.store'
import { ChangePasswordPanel } from './ChangePasswordPanel'
import { KeyFilePanel, type KeyFileMode } from './KeyFilePanel'
import { SettingRow, SettingsSection } from './SettingRow'

type Subpage = { kind: 'password' } | { kind: 'key-file'; mode: KeyFileMode } | null
type RowButton = 'password' | 'generate' | 'existing' | 'remove'

// Radix unmounts an inactive tab, so switching tabs or closing Settings drops any open subpage.
export function SecurityPanel({
  onLockChange
}: {
  onLockChange: (locked: boolean) => void
}): ReactNode {
  const { setPref } = usePrefsStore()
  const {
    autoLockMinutes,
    lockOnMinimize,
    allowScreenCapture,
    clipboardClearSeconds,
    clearClipboardOnLock
  } = usePrefsStore(
    useShallow((s) => ({
      autoLockMinutes: s.autoLockMinutes,
      lockOnMinimize: s.lockOnMinimize,
      allowScreenCapture: s.allowScreenCapture,
      clipboardClearSeconds: s.clipboardClearSeconds,
      clearClipboardOnLock: s.clearClipboardOnLock
    }))
  )

  const [subpage, setSubpage] = useState<Subpage>(null)
  const [hasKeyFile, setHasKeyFile] = useState(false)

  // The row button is gone while its subpage is open, so focus would land on the dialog root on the
  // way back; the button that opened it autofocuses as it remounts. Adding or removing a key file
  // swaps the row's buttons, so each one also takes focus meant for the button it replaced.
  const [openedFrom, setOpenedFrom] = useState<RowButton | null>(null)
  const openSubpage = (target: Exclude<Subpage, null>, from: RowButton): void => {
    setOpenedFrom(from)
    setSubpage(target)
  }
  const returnsFocusTo = (...accepts: RowButton[]): boolean =>
    openedFrom !== null && accepts.includes(openedFrom)

  // The OS dialog comes first; a cancelled dialog leaves Security as it was.
  const addKeyFile = async (source: 'generate' | 'existing'): Promise<void> => {
    const res =
      source === 'generate'
        ? await notvex.vault.generateKeyFile()
        : await notvex.vault.selectKeyFile()
    if (!res.success) {
      toast.error(res.error)
      return
    }
    if (!res.data) return
    openSubpage(
      {
        kind: 'key-file',
        mode: { kind: 'add', contents: res.data.contents, filename: res.data.filename }
      },
      source
    )
  }

  useEffect(() => {
    void notvex.vault.getHasKeyFile().then((r) => {
      setHasKeyFile(r.success ? r.data : false)
    })
  }, [])

  if (subpage?.kind === 'password') {
    return <ChangePasswordPanel onBack={() => setSubpage(null)} onLockChange={onLockChange} />
  }
  if (subpage?.kind === 'key-file') {
    return (
      <KeyFilePanel
        mode={subpage.mode}
        onBack={() => setSubpage(null)}
        onHasKeyFileChange={setHasKeyFile}
        onLockChange={onLockChange}
      />
    )
  }

  return (
    <>
      <SettingsSection title="Auto-lock">
        <SettingRow
          label="Timeout"
          description="Automatically lock the vault after a period of inactivity."
        >
          <Select
            value={String(autoLockMinutes)}
            onValueChange={(minutes) => void setPref('autoLockMinutes', Number(minutes))}
          >
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
            onCheckedChange={(v) => void setPref('lockOnMinimize', v === true)}
          />
        </SettingRow>
      </SettingsSection>

      <Separator />

      <SettingsSection title="Clipboard">
        <SettingRow
          label="Auto-clear"
          description="Automatically clear text copied from Notvex. Your recovery key is always cleared after 30 seconds."
        >
          <Select
            value={String(clipboardClearSeconds)}
            onValueChange={(seconds) => void setPref('clipboardClearSeconds', Number(seconds))}
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

        <SettingRow
          label="Clear when locked"
          description="Clear text copied from Notvex when the vault locks or Notvex quits. Your recovery key keeps its 30 seconds on lock, so you have time to paste it."
        >
          <Checkbox
            aria-label="Clear when locked"
            checked={clearClipboardOnLock}
            onCheckedChange={(v) => void setPref('clearClipboardOnLock', v === true)}
          />
        </SettingRow>
      </SettingsSection>

      <Separator />

      <SettingsSection title="Privacy">
        <SettingRow
          label="Prevent screen capture"
          description="Hides Notvex from screenshots and screen sharing. Requires restart."
        >
          <Checkbox
            aria-label="Prevent screen capture"
            checked={!allowScreenCapture}
            onCheckedChange={(v) => void setPref('allowScreenCapture', !(v === true))}
          />
        </SettingRow>
      </SettingsSection>

      <Separator />

      <SettingsSection title="Authentication">
        <SettingRow label="Password" description="Change the password used to unlock this vault.">
          <Button
            variant="secondary"
            size="sm"
            autoFocus={returnsFocusTo('password')}
            onClick={() => openSubpage({ kind: 'password' }, 'password')}
          >
            <LockIcon />
            Change password
          </Button>
        </SettingRow>

        <SettingRow
          label="Key file"
          description={
            <div className="space-y-1">
              <p>
                A second factor: with one set, you need both your password and the file to unlock.
              </p>
              <span className="flex items-center gap-1.5">
                {hasKeyFile ? (
                  <ShieldCheckIcon className="text-primary h-3.5 w-3.5" />
                ) : (
                  <ShieldOffIcon className="h-3.5 w-3.5" />
                )}
                {hasKeyFile ? 'Configured' : 'Not configured'}
              </span>
            </div>
          }
        >
          {hasKeyFile ? (
            <Button
              variant="destructive"
              size="sm"
              autoFocus={returnsFocusTo('remove', 'generate', 'existing')}
              onClick={() => openSubpage({ kind: 'key-file', mode: { kind: 'remove' } }, 'remove')}
            >
              <Trash2Icon />
              Remove…
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                autoFocus={returnsFocusTo('generate', 'remove')}
                onClick={() => void addKeyFile('generate')}
              >
                <FileKeyIcon />
                Generate…
              </Button>
              <Button
                variant="secondary"
                size="sm"
                autoFocus={returnsFocusTo('existing')}
                onClick={() => void addKeyFile('existing')}
              >
                <FolderOpenIcon />
                Use existing…
              </Button>
            </div>
          )}
        </SettingRow>
      </SettingsSection>

      <Separator />

      <SettingsSection title="Always-on protections">
        <p className="text-muted-foreground text-xs">
          Notvex always locks the vault when the system sleeps or the screen locks, and applies a
          progressive delay after repeated failed unlock attempts. These protections are built in
          and cannot be turned off.
        </p>
      </SettingsSection>
    </>
  )
}
