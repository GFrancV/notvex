import { useEffect, useRef, useState, type ReactNode } from 'react'

import { KeyIcon, LockIcon, ShieldCheckIcon, ShieldOffIcon } from 'lucide-react'
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
import { KeyFilePanel } from './KeyFilePanel'
import { SettingRow, SettingsSection } from './SettingRow'

type Subpage = 'password' | 'key-file' | null

// Radix unmounts an inactive tab, so switching tabs or closing Settings drops any open subpage.
export function SecurityPanel({
  onLockChange
}: {
  onLockChange: (locked: boolean) => void
}): ReactNode {
  const { setPref } = usePrefsStore()
  const { autoLockMinutes, lockOnMinimize, allowScreenCapture, clipboardClearSeconds } =
    usePrefsStore(
      useShallow((s) => ({
        autoLockMinutes: s.autoLockMinutes,
        lockOnMinimize: s.lockOnMinimize,
        allowScreenCapture: s.allowScreenCapture,
        clipboardClearSeconds: s.clipboardClearSeconds
      }))
    )

  const [subpage, setSubpage] = useState<Subpage>(null)
  const [hasKeyFile, setHasKeyFile] = useState(false)

  // The row button is gone while its subpage is open, so focus would land on the dialog root on the
  // way back; the remounted button takes it instead.
  const returnFocusTo = useRef<Subpage>(null)
  const openSubpage = (target: Exclude<Subpage, null>): void => {
    returnFocusTo.current = target
    setSubpage(target)
  }
  const focusOnReturn =
    (target: Exclude<Subpage, null>) =>
    (button: HTMLButtonElement | null): void => {
      if (!button || returnFocusTo.current !== target) return
      returnFocusTo.current = null
      button.focus()
    }

  useEffect(() => {
    void notvex.vault.getHasKeyFile().then((r) => {
      setHasKeyFile(r.success ? r.data : false)
    })
  }, [])

  if (subpage === 'password') {
    return <ChangePasswordPanel onBack={() => setSubpage(null)} onLockChange={onLockChange} />
  }
  if (subpage === 'key-file') {
    return (
      <KeyFilePanel
        onBack={() => setSubpage(null)}
        hasKeyFile={hasKeyFile}
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
          description="Automatically clear the clipboard after copying text from the note editor."
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
            ref={focusOnReturn('password')}
            onClick={() => openSubpage('password')}
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
            ref={focusOnReturn('key-file')}
            onClick={() => openSubpage('key-file')}
          >
            <KeyIcon />
            Manage
          </Button>
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
