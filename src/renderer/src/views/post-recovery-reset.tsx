import { type ReactNode, useEffect, useState } from 'react'

import { AlertTriangleIcon, InfoIcon, KeyRoundIcon, LockIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PasswordInput } from '@/components/PasswordInput'
import { PasswordStrengthBar } from '@/components/password-strength-bar'
import { RecoveryWordsGrid } from '@/components/recovery-words-grid'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { notvex } from '@/lib/ipc'
import { passwordStrength } from '@/lib/utils'
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
  const [confirmed, setConfirmed] = useState(false)
  const [hadKeyFile, setHadKeyFile] = useState(false)

  useEffect(() => {
    void notvex.vault.getHasKeyFile().then((r) => {
      setHadKeyFile(r.success ? r.data : false)
    })
  }, [])

  const passwordsMatch = newPassword === confirmPassword
  const confirmTouched = confirmPassword.length > 0
  const strength = passwordStrength(newPassword)
  const canSubmit = !loading && passwordsMatch && (strength === 'medium' || strength === 'strong')

  const handleSetPassword = async (): Promise<void> => {
    setError('')
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
    toast.success('Password updated successfully')
  }

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center p-8">
      <div className="titlebar-drag absolute top-0 right-0 left-0 h-11" />
      <div className="w-full max-w-md">
        {step === 'password' ? (
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-6 duration-200">
            <div className="flex flex-col items-center gap-3">
              <div className="border-primary/20 bg-primary/15 shadow-glow-primary flex h-14 w-14 items-center justify-center rounded-xl border">
                <LockIcon className="text-primary h-7 w-7" />
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
              <Field>
                <FieldLabel htmlFor="new-password">New password</FieldLabel>
                <PasswordInput
                  id="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 12 characters"
                />
                {newPassword.length > 0 && <PasswordStrengthBar password={newPassword} />}
              </Field>

              <Field data-invalid={confirmTouched && !passwordsMatch}>
                <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                <PasswordInput
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  onKeyDown={(e): void => {
                    if (e.key === 'Enter' && canSubmit) void handleSetPassword()
                  }}
                  aria-invalid={confirmTouched && !passwordsMatch}
                />
                {confirmTouched && !passwordsMatch && (
                  <FieldDescription className="text-destructive">
                    ✕ Passwords do not match
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <Button
              className="w-full"
              disabled={!canSubmit}
              onClick={(): void => {
                void handleSetPassword()
              }}
            >
              {loading ? 'Updating password…' : 'Set new password'}
            </Button>
          </div>
        ) : (
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-6 duration-200">
            <div className="flex flex-col items-center gap-3">
              <div className="border-primary/20 bg-primary/15 shadow-glow-primary flex h-14 w-14 items-center justify-center rounded-xl border">
                <KeyRoundIcon className="text-primary h-7 w-7" />
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-tight">Save your new recovery key</h1>
              </div>
            </div>

            <Alert variant="warning">
              <AlertTriangleIcon />
              <AlertDescription>
                Your recovery key has changed and the previous one no longer works. Write it down by
                hand or copy it on a device you trust, and keep it somewhere safe. It won&apos;t be
                shown again.
              </AlertDescription>
            </Alert>

            <RecoveryWordsGrid mnemonic={mnemonic} />

            {hadKeyFile && (
              <Alert className="border-border border">
                <InfoIcon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                <AlertDescription className="text-muted-foreground text-sm">
                  Your key file has not changed. You will still need it along with your new password
                  to unlock your vault.
                </AlertDescription>
              </Alert>
            )}

            <Field orientation="horizontal">
              <Checkbox
                id="confirm-recovery"
                checked={confirmed}
                onCheckedChange={(c) => setConfirmed(c === true)}
              />
              <FieldLabel htmlFor="confirm-recovery">
                I&apos;ve saved my recovery key somewhere safe. I understand I cannot recover it if
                lost.
              </FieldLabel>
            </Field>

            <Button
              className="w-full"
              disabled={!confirmed}
              onClick={(): void => {
                void handleContinue()
              }}
            >
              Continue to my notes
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
