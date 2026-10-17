import { type ReactNode, useEffect, useState } from 'react'

import { AlertTriangleIcon } from 'lucide-react'

import { KeyFileInput } from '@/components/KeyFileInput'
import { PasswordInput } from '@/components/PasswordInput'
import { PasswordStrengthBar } from '@/components/password-strength-bar'
import { RecoveryWordsGrid } from '@/components/recovery-words-grid'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { notvex } from '@/lib/ipc'
import { SubpageHeader } from './SettingRow'

interface ChangePasswordPanelProps {
  onBack: () => void
  /** True while leaving would discard the new recovery key; see SettingsDialog. */
  onLockChange: (locked: boolean) => void
}

type Step = 'form' | 'mnemonic'

// Mounted only while the subpage is open, so leaving it discards every field and the mnemonic.
export function ChangePasswordPanel({ onBack, onLockChange }: ChangePasswordPanelProps): ReactNode {
  const [step, setStep] = useState<Step>('form')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [mnemonicConfirmed, setMnemonicConfirmed] = useState(false)
  const [hasKeyFile, setHasKeyFile] = useState(false)
  const [keyFileContents, setKeyFileContents] = useState<Uint8Array | null>(null)

  useEffect(() => {
    void notvex.vault.getHasKeyFile().then((r) => {
      setHasKeyFile(r.success ? r.data : false)
    })
  }, [])

  const validationError = (): string => {
    if (!currentPw || !newPw || !confirmPw) return 'All fields are required'
    if (hasKeyFile && !keyFileContents) return 'Key file is required'
    if (newPw.length < 12) return 'New password must be at least 12 characters'
    if (newPw === currentPw) return 'New password must differ from the current one'
    if (newPw !== confirmPw) return 'New passwords do not match'
    return ''
  }

  const canSubmit = !loading && !validationError()

  // Main has already re-keyed the vault by the time the mnemonic arrives, so it must be seen.
  const locked = loading || step === 'mnemonic'

  const finish = (): void => {
    onLockChange(false)
    onBack()
  }

  const handleSubmit = async (): Promise<void> => {
    const ve = validationError()
    if (ve) {
      setError(ve)
      return
    }
    setError('')
    setLoading(true)
    onLockChange(true)
    // A rejected call must still release the lock, or the dialog could never be left.
    const res = await notvex.vault
      .changePassword(currentPw, newPw, keyFileContents ?? undefined)
      .catch(() => ({ success: false as const, error: 'Something went wrong. Try again.' }))
    setLoading(false)
    if (!res.success) {
      onLockChange(false)
      setError(res.error)
      return
    }
    setMnemonic(res.data.mnemonic)
    setStep('mnemonic')
  }

  return (
    <div className="space-y-2">
      <SubpageHeader
        parent="Security"
        title="Change password"
        onBack={onBack}
        backDisabled={locked}
      />

      {step === 'form' && (
        <div className="mt-2 space-y-4">
          {/* Current password */}
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <PasswordInput
              id="current-password"
              autoFocus
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="Your current password"
            />
          </Field>

          {/* Key file (only shown when vault has one configured) */}
          {hasKeyFile && (
            <Field>
              <FieldLabel>Key file</FieldLabel>
              <KeyFileInput
                onChange={(c) => setKeyFileContents(c)}
                onClear={() => setKeyFileContents(null)}
              />
            </Field>
          )}

          {/* New password */}
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <PasswordInput
              id="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="At least 12 characters"
            />
            {newPw.length > 0 && <PasswordStrengthBar password={newPw} />}
          </Field>

          {/* Confirm new password */}
          <Field>
            <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
            <PasswordInput
              id="confirm-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Repeat new password"
              onKeyDown={(e): void => {
                if (e.key === 'Enter' && canSubmit) void handleSubmit()
              }}
            />
          </Field>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={onBack} disabled={loading}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={(): void => {
                void handleSubmit()
              }}
              disabled={!canSubmit}
            >
              {loading ? 'Re-encrypting vault…' : 'Change password'}
            </Button>
          </div>
        </div>
      )}

      {step === 'mnemonic' && (
        <div className="mt-2 space-y-4">
          <h3 className="font-semibold">Save your new recovery key</h3>
          <Alert className="border-warning/30 bg-warning/10 border">
            <AlertTriangleIcon className="stroke-warning mt-0.5 h-4 w-4 shrink-0" />
            <AlertDescription className="text-warning">
              Your recovery key has changed and the previous one no longer works. Write it down by
              hand or copy it on a device you trust, and keep it somewhere safe. It won&apos;t be
              shown again.
            </AlertDescription>
          </Alert>

          <RecoveryWordsGrid mnemonic={mnemonic} />

          <Field orientation="horizontal">
            <Checkbox
              id="cpd-confirm-recovery"
              checked={mnemonicConfirmed}
              onCheckedChange={(c) => setMnemonicConfirmed(c === true)}
            />
            <FieldLabel htmlFor="cpd-confirm-recovery">
              I&apos;ve saved my new recovery key somewhere safe.
            </FieldLabel>
          </Field>

          <Button className="w-full" disabled={!mnemonicConfirmed} onClick={finish}>
            Done
          </Button>
        </div>
      )}
    </div>
  )
}
