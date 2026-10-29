import { type ReactNode, useEffect, useState } from 'react'

import { KeyRoundIcon, LockIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PasswordInput } from '@/components/PasswordInput'
import { PasswordStrengthBar } from '@/components/password-strength-bar'
import { KEY_REPLACED, RecoveryKeyStep } from '@/components/RecoveryKeyStep'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useFieldErrors } from '@/hooks/use-field-errors'
import { notvex } from '@/lib/ipc'
import { confirmError, newPasswordError } from '@/lib/password-rules'
import { useVaultStore } from '@/store/vault.store'

type Step = 'password' | 'recovery'

export function PostRecoveryReset(): ReactNode {
  const setNeedsRecoveryReset = useVaultStore((s) => s.setNeedsRecoveryReset)

  const [step, setStep] = useState<Step>('password')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [hadKeyFile, setHadKeyFile] = useState(false)

  useEffect(() => {
    void notvex.vault.getHasKeyFile().then((r) => {
      setHadKeyFile(r.success ? r.data : false)
    })
  }, [])

  const fields = useFieldErrors({
    newPassword: newPasswordError(newPassword),
    confirm: confirmError(newPassword, confirmPassword)
  })

  const handleSetPassword = async (): Promise<void> => {
    setError('')
    if (!fields.submit()) return
    setLoading(true)
    const res = await notvex.vault.rotateCredentials(newPassword)
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setMnemonic(res.data.mnemonic)
    setStep('recovery')
  }

  const handleContinue = async (): Promise<void> => {
    await notvex.vault.confirmRecoverySaved()
    setMnemonic('')
    setNeedsRecoveryReset(false)
    toast.success('Password updated')
  }

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center p-8">
      <div className="titlebar-drag absolute top-0 right-0 left-0 h-11" />
      <div className="w-full max-w-md">
        {step === 'password' ? (
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-6 duration-200">
            <div className="flex flex-col items-center gap-3">
              <div className="border-primary/20 bg-primary/15 shadow-glow-primary flex h-14 w-14 items-center justify-center rounded-xl border">
                <LockIcon className="text-primary size-7" />
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-tight">Secure your vault</h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  You accessed your vault using your recovery key.
                  <br />
                  You must set a new password before continuing.
                </p>
              </div>
            </div>

            <FieldGroup>
              <Field data-invalid={!!fields.error('newPassword')}>
                <FieldLabel htmlFor="new-password">New password</FieldLabel>
                <PasswordInput
                  id="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onBlur={fields.touch('newPassword')}
                  placeholder="At least 12 characters"
                  aria-invalid={!!fields.error('newPassword')}
                />
                {newPassword.length > 0 && <PasswordStrengthBar password={newPassword} />}
                <FieldError>{fields.error('newPassword')}</FieldError>
              </Field>

              <Field data-invalid={!!fields.error('confirm')}>
                <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                <PasswordInput
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={fields.touch('confirm')}
                  placeholder="Repeat password"
                  onKeyDown={(e): void => {
                    if (e.key === 'Enter' && !loading) void handleSetPassword()
                  }}
                  aria-invalid={!!fields.error('confirm')}
                />
                <FieldError>{fields.error('confirm')}</FieldError>
              </Field>
            </FieldGroup>

            <FieldError>{error}</FieldError>

            <Button
              className="w-full"
              disabled={loading}
              onClick={(): void => {
                void handleSetPassword()
              }}
            >
              {loading && <Spinner aria-hidden />}
              {loading ? 'Updating password…' : 'Set new password'}
            </Button>
          </div>
        ) : (
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-6 duration-200">
            <div className="flex flex-col items-center gap-3">
              <div className="border-primary/20 bg-primary/15 shadow-glow-primary flex h-14 w-14 items-center justify-center rounded-xl border">
                <KeyRoundIcon className="text-primary size-7" />
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-tight">Save your new recovery key</h1>
              </div>
            </div>

            <RecoveryKeyStep
              mnemonic={mnemonic}
              context={KEY_REPLACED}
              note={
                hadKeyFile
                  ? 'Your key file has not changed. You will still need it along with your new password to unlock your vault.'
                  : undefined
              }
              confirmLabel="Done"
              onConfirm={() => void handleContinue()}
            />
          </div>
        )}
      </div>
    </div>
  )
}
