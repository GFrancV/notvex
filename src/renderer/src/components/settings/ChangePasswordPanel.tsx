import { type ReactNode, useEffect, useState } from 'react'

import { KeyFileInput } from '@/components/KeyFileInput'
import { PasswordInput } from '@/components/PasswordInput'
import { PasswordStrengthBar } from '@/components/password-strength-bar'
import { KEY_REPLACED, RecoveryKeyStep } from '@/components/RecoveryKeyStep'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { useFieldErrors } from '@/hooks/use-field-errors'
import { notvex } from '@/lib/ipc'
import { confirmError, newPasswordError } from '@/lib/password-rules'
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
  const [hasKeyFile, setHasKeyFile] = useState(false)
  const [keyFileContents, setKeyFileContents] = useState<Uint8Array | null>(null)

  useEffect(() => {
    void notvex.vault.getHasKeyFile().then((r) => {
      setHasKeyFile(r.success ? r.data : false)
    })
  }, [])

  const fields = useFieldErrors({
    current: currentPw ? null : 'Enter your current password',
    keyFile: hasKeyFile && !keyFileContents ? 'Choose your key file' : null,
    newPw: newPasswordError(newPw, currentPw),
    confirm: confirmError(newPw, confirmPw)
  })

  // Main has already re-keyed the vault by the time the mnemonic arrives, so it must be seen.
  const locked = loading || step === 'mnemonic'

  const finish = (): void => {
    // A failed confirm keeps the vault flagged in main, so the next unlock warns instead.
    void notvex.vault.confirmRecoverySaved().catch(() => undefined)
    onLockChange(false)
    onBack()
  }

  const handleSubmit = async (): Promise<void> => {
    setError('')
    if (!fields.submit()) return
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
          <Field data-invalid={!!fields.error('current')}>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <PasswordInput
              id="current-password"
              autoFocus
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              onBlur={fields.touch('current')}
              placeholder="Your current password"
              aria-invalid={!!fields.error('current')}
            />
            <FieldError>{fields.error('current')}</FieldError>
          </Field>

          {/* Key file (only shown when vault has one configured) */}
          {hasKeyFile && (
            <Field data-invalid={!!fields.error('keyFile')}>
              <FieldLabel>Key file</FieldLabel>
              <KeyFileInput
                onChange={(c) => setKeyFileContents(c)}
                onClear={() => setKeyFileContents(null)}
              />
              <FieldError>{fields.error('keyFile')}</FieldError>
            </Field>
          )}

          {/* New password */}
          <Field data-invalid={!!fields.error('newPw')}>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <PasswordInput
              id="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              onBlur={fields.touch('newPw')}
              placeholder="At least 12 characters"
              aria-invalid={!!fields.error('newPw')}
            />
            {newPw.length > 0 && <PasswordStrengthBar password={newPw} />}
            <FieldError>{fields.error('newPw')}</FieldError>
          </Field>

          {/* Confirm new password */}
          <Field data-invalid={!!fields.error('confirm')}>
            <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
            <PasswordInput
              id="confirm-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              onBlur={fields.touch('confirm')}
              placeholder="Repeat new password"
              onKeyDown={(e): void => {
                if (e.key === 'Enter' && !loading) void handleSubmit()
              }}
              aria-invalid={!!fields.error('confirm')}
            />
            <FieldError>{fields.error('confirm')}</FieldError>
          </Field>

          <FieldError>{error}</FieldError>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={onBack} disabled={loading}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={(): void => {
                void handleSubmit()
              }}
              disabled={loading}
            >
              {loading ? 'Re-encrypting vault…' : 'Change password'}
            </Button>
          </div>
        </div>
      )}

      {step === 'mnemonic' && (
        <div className="mt-2 space-y-4">
          <h3 className="font-semibold">Save your new recovery key</h3>
          <RecoveryKeyStep
            mnemonic={mnemonic}
            context={KEY_REPLACED}
            confirmLabel="Done"
            onConfirm={finish}
          />
        </div>
      )}
    </div>
  )
}
