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
}

type Step = 'form' | 'mnemonic'

// Mounted only while the subpage is open, so leaving it discards every field and the mnemonic.
export function ChangePasswordPanel({ onBack }: ChangePasswordPanelProps): ReactNode {
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

  const handleSubmit = async (): Promise<void> => {
    const ve = validationError()
    if (ve) {
      setError(ve)
      return
    }
    setError('')
    setLoading(true)
    const res = await notvex.vault.changePassword(currentPw, newPw, keyFileContents ?? undefined)
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setMnemonic(res.data.mnemonic)
    setStep('mnemonic')
  }

  return (
    <div className="space-y-2">
      <SubpageHeader parent="Security" title="Change password" onBack={onBack} />

      {step === 'form' && (
        <div className="mt-2 space-y-4">
          {/* Current password */}
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <PasswordInput
              id="current-password"
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
              Your recovery key has changed. The previous key is no longer valid. Save this new one
              — it will not be shown again.
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
              I have saved my new recovery key in a secure location.
            </FieldLabel>
          </Field>

          <Button className="w-full" disabled={!mnemonicConfirmed} onClick={onBack}>
            Done
          </Button>
        </div>
      )}
    </div>
  )
}
