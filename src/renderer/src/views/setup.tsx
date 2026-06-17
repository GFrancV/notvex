import { type ReactNode, useState } from 'react'

import { AlertTriangleIcon, EyeIcon, EyeOffIcon, FolderOpenIcon } from 'lucide-react'

import { AppLogo } from '@/components/AppLogo'
import { PasswordStrengthBar } from '@/components/password-strength-bar'
import { RecoveryWordsGrid } from '@/components/recovery-words-grid'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { notvex } from '@/lib/ipc'
import { useVaultStore } from '@/store/vault.store'

type Step = 'location' | 'password' | 'recovery'

export function Setup(): ReactNode {
  const setStatus = useVaultStore((s) => s.setStatus)
  const pendingNewVaultPath = useVaultStore((s) => s.pendingNewVaultPath)
  const setPendingNewVaultPath = useVaultStore((s) => s.setPendingNewVaultPath)

  // When opened from the vault switcher the path is already chosen — skip the location step
  const [step, setStep] = useState<Step>(pendingNewVaultPath ? 'password' : 'location')
  const [vaultPath, setVaultPath] = useState(pendingNewVaultPath ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const passwordsMatch = password === confirm
  const confirmTouched = confirm.length > 0

  const handleChooseFile = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('new')
    if (res.success && res.data) setVaultPath(res.data)
  }

  const handleCreate = async (): Promise<void> => {
    setError('')
    if (password.length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    if (!passwordsMatch) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const res = await notvex.vault.create(vaultPath, password)
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setMnemonic(res.data.mnemonic)
    setStep('recovery')
  }

  const handleFinish = (): void => {
    setPendingNewVaultPath(null)
    setStatus('unlocked')
  }

  const handleBackToUnlock = (): void => {
    setPendingNewVaultPath(null)
    setStatus('locked')
  }

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center p-8">
      <div className="titlebar-drag absolute top-0 right-0 left-0 h-11" />
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <AppLogo />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Notvex</h1>
            <p className="text-muted mt-1 text-sm">Create your secure vault</p>
          </div>
        </div>

        {/* Step: Location */}
        {step === 'location' && (
          <FieldGroup>
            <Field>
              <FieldLabel>Vault file</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={vaultPath ? vaultPath.split(/[\\/]/).pop()! : ''}
                  placeholder="Choose where to save..."
                  readOnly
                  title={vaultPath}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={(): void => {
                    void handleChooseFile()
                  }}
                >
                  <FolderOpenIcon className="h-4 w-4" />
                </Button>
              </div>
              <FieldDescription className="text-muted text-xs">
                Your vault will be saved as a single <code className="text-primary">.nvx</code>{' '}
                file. Copy it to back up everything.
              </FieldDescription>
            </Field>

            <Button className="w-full" disabled={!vaultPath} onClick={() => setStep('password')}>
              Continue
            </Button>
          </FieldGroup>
        )}

        {/* Step: Password */}
        {step === 'password' && (
          <div className="space-y-6">
            <div className="bg-sidebar rounded-lg border p-3">
              <p className="text-muted text-xs">
                <span className="text-muted-foreground">File:</span> {vaultPath}
              </p>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="password">Master password</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 12 characters"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton onClick={() => setShowPassword((v) => !v)}>
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {password.length > 0 && (
                  <FieldDescription>
                    <PasswordStrengthBar password={password} />
                  </FieldDescription>
                )}
              </Field>

              <Field data-invalid={confirmTouched && !passwordsMatch}>
                <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    onKeyDown={(e): void => {
                      if (e.key === 'Enter') void handleCreate()
                    }}
                    aria-invalid={confirmTouched && !passwordsMatch}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton onClick={() => setShowConfirm((v) => !v)}>
                      {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {confirmTouched && !passwordsMatch && (
                  <FieldDescription className="text-destructive">
                    ✕ Passwords do not match
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep('location')}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={(): void => {
                  void handleCreate()
                }}
                disabled={loading}
              >
                {loading ? 'Creating vault…' : 'Create vault'}
              </Button>
            </div>

            <p className="text-muted text-center text-xs">
              This derives your encryption key using Argon2id. May take a few seconds.
            </p>
          </div>
        )}

        {/* Step: Recovery key */}
        {step === 'recovery' && (
          <div className="space-y-6">
            <Alert className="border-warning/30 bg-warning/10 border">
              <AlertTriangleIcon className="stroke-warning mt-0.5 h-4 w-4 shrink-0" />
              <AlertTitle className="text-warning">Save your recovery key</AlertTitle>
              <AlertDescription className="text-warning/70">
                If you lose your password, this is the only way to recover your notes. Write it down
                or store it in a password manager. It will never be shown again.
              </AlertDescription>
            </Alert>

            <RecoveryWordsGrid mnemonic={mnemonic} />

            <Field orientation="horizontal">
              <Checkbox
                id="setup-confirm-recovery"
                checked={confirmed}
                onCheckedChange={(c) => setConfirmed(c === true)}
              />
              <FieldLabel htmlFor="setup-confirm-recovery">
                I have saved my recovery key in a secure location. I understand that if I lose both
                my password and this key, my notes are irrecoverable.
              </FieldLabel>
            </Field>

            <Button className="w-full" disabled={!confirmed} onClick={handleFinish}>
              Start using Notvex
            </Button>
          </div>
        )}

        {/* Escape hatch when creating a new vault from the switcher — hidden once the
            vault exists (recovery step) */}
        {pendingNewVaultPath && step !== 'recovery' && (
          <p className="mt-6 text-center">
            <Button
              variant="link"
              className="text-muted h-auto p-0 text-xs font-normal"
              onClick={handleBackToUnlock}
            >
              ← Back to unlock
            </Button>
          </p>
        )}
      </div>
    </div>
  )
}
