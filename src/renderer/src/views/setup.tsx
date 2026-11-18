import { type ReactNode, useState } from 'react'

import { FolderOpenIcon, LockIcon, PlusIcon } from 'lucide-react'

import { AppLogo } from '@/components/AppLogo'
import { FieldErrorSlot } from '@/components/FieldErrorSlot'
import { KdfLevelChooser } from '@/components/KdfLevelChooser'
import { PasswordInput } from '@/components/PasswordInput'
import { PasswordStrengthBar } from '@/components/password-strength-bar'
import { RecoveryKeyStep } from '@/components/RecoveryKeyStep'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFieldErrors } from '@/hooks/use-field-errors'
import { useIsDev } from '@/hooks/use-is-dev'
import { usePickVault } from '@/hooks/use-pick-vault'
import { notvex } from '@/lib/ipc'
import { confirmError, newPasswordError } from '@/lib/password-rules'
import { vaultFolderAndName } from '@/lib/utils'
import { usePrefsStore } from '@/store/prefs.store'
import { useVaultStore } from '@/store/vault.store'
import { DEFAULT_KDF_LEVEL_ID } from '@shared/kdf-levels'

type Step = 'location' | 'password' | 'recovery'

const SUBTITLES: Record<Step, string> = {
  location: 'Create or open a vault',
  password: 'Create new vault',
  recovery: 'Create your secure vault'
}

export function Setup(): ReactNode {
  const isDev = useIsDev()
  const {
    setStatus,
    setCurrentVaultPath,
    pendingNewVaultPath,
    setPendingNewVaultPath,
    setPendingOpenVaultPath
  } = useVaultStore()

  const { pickExistingVault, pickNewVault } = usePickVault()

  // When opened from the vault switcher the path is already chosen — skip the location step
  const [step, setStep] = useState<Step>(pendingNewVaultPath ? 'password' : 'location')
  const [vaultPath, setVaultPath] = useState(pendingNewVaultPath ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [kdfLevelId, setKdfLevelId] = useState(DEFAULT_KDF_LEVEL_ID)

  const fields = useFieldErrors({
    password: newPasswordError(password),
    confirm: confirmError(password, confirm)
  })

  const showUnlockFor = (path: string): void => {
    setPendingOpenVaultPath(path)
    handleBackToUnlock()
  }

  const handleCreateNew = async (): Promise<void> => {
    const path = await pickNewVault(showUnlockFor)
    if (!path) return
    setVaultPath(path)
    setStep('password')
  }

  const handleOpenExisting = async (): Promise<void> => {
    const selectedPath = await pickExistingVault()
    if (selectedPath) showUnlockFor(selectedPath)
  }

  const handleCreate = async (): Promise<void> => {
    setError('')
    if (!fields.submit()) return
    setLoading(true)
    const res = await notvex.vault.create(vaultPath, password, kdfLevelId)
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
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <AppLogo />
          <div className="text-center">
            <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight">
              Notvex
              {isDev && <Badge variant="secondary">Dev</Badge>}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">{SUBTITLES[step]}</p>
          </div>
        </div>

        {/* Step: Location */}
        {step === 'location' && (
          <div className="flex flex-col gap-3">
            <Button className="w-full" onClick={() => void handleCreateNew()}>
              <PlusIcon aria-hidden />
              Create new vault…
            </Button>
            <Button variant="outline" className="w-full" onClick={handleOpenExisting}>
              <FolderOpenIcon aria-hidden />
              Open existing vault…
            </Button>
            <p className="text-muted-foreground mt-1 text-center text-xs">
              Each vault is a single <code className="text-primary">.nvx</code> file. Copy it to
              back up everything.
            </p>
          </div>
        )}

        {/* Step: Password */}
        {step === 'password' && (
          <div className="space-y-6">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  className="bg-sidebar text-muted-foreground flex items-center gap-2 rounded-lg border p-3 text-xs"
                >
                  <LockIcon className="size-3.5" aria-hidden />
                  <span>{vaultFolderAndName(vaultPath)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>{vaultPath}</TooltipContent>
            </Tooltip>

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
                <FieldErrorSlot>{fields.error('password')}</FieldErrorSlot>
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
                <FieldErrorSlot>{fields.error('confirm')}</FieldErrorSlot>
              </Field>
            </FieldGroup>

            <KdfLevelChooser value={kdfLevelId} onChange={setKdfLevelId} />

            <FieldError>{error}</FieldError>

            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => setStep('location')}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={(): void => {
                  void handleCreate()
                }}
                disabled={loading}
              >
                {loading && <Spinner aria-hidden />}
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
