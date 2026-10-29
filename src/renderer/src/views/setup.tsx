import { type ReactNode, useState } from 'react'

import { FolderOpenIcon } from 'lucide-react'

import { AppLogo } from '@/components/AppLogo'
import { PasswordInput } from '@/components/PasswordInput'
import { PasswordStrengthBar } from '@/components/password-strength-bar'
import { RecoveryKeyStep } from '@/components/RecoveryKeyStep'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFieldErrors } from '@/hooks/use-field-errors'
import { useIsDev } from '@/hooks/use-is-dev'
import { usePickVault } from '@/hooks/use-pick-vault'
import { notvex } from '@/lib/ipc'
import { confirmError, newPasswordError } from '@/lib/password-rules'
import { usePrefsStore } from '@/store/prefs.store'
import { useVaultStore } from '@/store/vault.store'

type Step = 'location' | 'password' | 'recovery'

export function Setup(): ReactNode {
  const isDev = useIsDev()
  const {
    setStatus,
    setCurrentVaultPath,
    pendingNewVaultPath,
    setPendingNewVaultPath,
    setPendingOpenVaultPath
  } = useVaultStore()

  const { pickExistingVault } = usePickVault()

  // When opened from the vault switcher the path is already chosen — skip the location step
  const [step, setStep] = useState<Step>(pendingNewVaultPath ? 'password' : 'location')
  const [vaultPath, setVaultPath] = useState(pendingNewVaultPath ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const fields = useFieldErrors({
    password: newPasswordError(password),
    confirm: confirmError(password, confirm)
  })

  const handleChooseFile = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('new')
    if (res.success && res.data) setVaultPath(res.data)
  }

  const handleOpenExisting = async (): Promise<void> => {
    const selectedPath = await pickExistingVault()
    if (!selectedPath) return

    setPendingOpenVaultPath(selectedPath)
    handleBackToUnlock()
  }

  const handleCreate = async (): Promise<void> => {
    setError('')
    if (!fields.submit()) return
    setLoading(true)
    const res = await notvex.vault.create(vaultPath, password)
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    // The vault is open now: a lock before Finish routes to Unlock for it (see clearSession).
    // On first run this is the only record of it, since prefs reload only at Finish.
    setPendingNewVaultPath(vaultPath)
    setMnemonic(res.data.mnemonic)
    setStep('recovery')
  }

  const handleFinish = async (): Promise<void> => {
    // See ChangePasswordPanel: a failed confirm only means the next unlock warns.
    void notvex.vault.confirmRecoverySaved().catch(() => undefined)
    await usePrefsStore.getState().load()
    // A lock during the reload already routed to Unlock (clearSession dropped the pending path).
    if (useVaultStore.getState().pendingNewVaultPath === null) return
    setPendingNewVaultPath(null)
    setCurrentVaultPath(vaultPath)
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
            <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight">
              Notvex
              {isDev && <Badge variant="secondary">Dev</Badge>}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">Create your secure vault</p>
          </div>
        </div>

        {/* Step: Location */}
        {step === 'location' && (
          <div className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Vault file</FieldLabel>
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        value={vaultPath ? vaultPath.split(/[\\/]/).pop()! : ''}
                        placeholder="Choose where to save…"
                        readOnly
                        className="flex-1"
                      />
                    </TooltipTrigger>
                    <TooltipContent>{vaultPath}</TooltipContent>
                  </Tooltip>
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
                <FieldDescription className="text-muted-foreground text-xs">
                  Your vault will be saved as a single <code className="text-primary">.nvx</code>{' '}
                  file. Copy it to back up everything.
                </FieldDescription>
              </Field>

              <Button className="w-full" disabled={!vaultPath} onClick={() => setStep('password')}>
                Continue
              </Button>
            </FieldGroup>

            <FieldSeparator className="my-0 text-xs">or</FieldSeparator>

            <Button variant="outline" className="w-full" onClick={handleOpenExisting}>
              Open existing vault
            </Button>
          </div>
        )}

        {/* Step: Password */}
        {step === 'password' && (
          <div className="space-y-6">
            <div className="bg-sidebar rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">
                <span className="text-muted-foreground">File:</span> {vaultPath}
              </p>
            </div>

            <FieldGroup>
              <Field data-invalid={!!fields.error('password')}>
                <FieldLabel htmlFor="password">Master password</FieldLabel>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={fields.touch('password')}
                  placeholder="At least 12 characters"
                  aria-invalid={!!fields.error('password')}
                />
                {password.length > 0 && <PasswordStrengthBar password={password} />}
                <FieldError>{fields.error('password')}</FieldError>
              </Field>

              <Field data-invalid={!!fields.error('confirm')}>
                <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                <PasswordInput
                  id="confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onBlur={fields.touch('confirm')}
                  placeholder="Repeat password"
                  onKeyDown={(e): void => {
                    if (e.key === 'Enter') void handleCreate()
                  }}
                  aria-invalid={!!fields.error('confirm')}
                />
                <FieldError>{fields.error('confirm')}</FieldError>
              </Field>
            </FieldGroup>

            <FieldError>{error}</FieldError>

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

            <p className="text-muted-foreground text-center text-xs">
              This derives your encryption key using Argon2id. May take a few seconds.
            </p>
          </div>
        )}

        {/* Step: Recovery key */}
        {step === 'recovery' && (
          <div className="space-y-6">
            <h3 className="font-semibold">Save your recovery key</h3>
            <RecoveryKeyStep
              mnemonic={mnemonic}
              context="If you lose your password, this is the only way to recover your notes."
              confirmLabel="Start using Notvex"
              onConfirm={() => void handleFinish()}
            />
          </div>
        )}

        {/* Escape hatch when creating a new vault from the switcher — hidden once the
            vault exists (recovery step) */}
        {pendingNewVaultPath && step !== 'recovery' && (
          <p className="mt-6 text-center">
            <Button
              variant="link"
              className="text-muted-foreground h-auto p-0 text-xs font-normal"
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
