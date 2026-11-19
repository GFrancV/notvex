import { type ReactNode, useEffect, useState } from 'react'

import { AlertTriangleIcon } from 'lucide-react'

import { FieldErrorSlot } from '@/components/FieldErrorSlot'
import { KdfLevelPicker } from '@/components/KdfLevelChooser'
import { KeyFileInput } from '@/components/KeyFileInput'
import { PasswordInput } from '@/components/PasswordInput'
import { KEY_REPLACED, RecoveryKeyStep } from '@/components/RecoveryKeyStep'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useFieldErrors } from '@/hooks/use-field-errors'
import { notvex } from '@/lib/ipc'
import { describeKdfLevel, KDF_LEVELS, type KdfLevel } from '@shared/kdf-levels'
import { SubpageHeader } from './SettingRow'

interface ChangeKdfLevelPanelProps {
  current: KdfLevel
  onBack: () => void
  /** True while leaving would discard the new recovery key; see SettingsDialog. */
  onLockChange: (locked: boolean) => void
}

type Step = 'choose' | 'confirm' | 'mnemonic'

// Mounted only while the subpage is open, so leaving it discards the choice, the password and
// the mnemonic.
export function ChangeKdfLevelPanel({
  current,
  onBack,
  onLockChange
}: ChangeKdfLevelPanelProps): ReactNode {
  const [step, setStep] = useState<Step>('choose')
  const [mnemonic, setMnemonic] = useState('')
  const [levelId, setLevelId] = useState(current.id)
  const [password, setPassword] = useState('')
  const [hasKeyFile, setHasKeyFile] = useState(false)
  const [keyFileContents, setKeyFileContents] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void notvex.vault.getHasKeyFile().then((r) => {
      setHasKeyFile(r.success ? r.data : false)
    })
  }, [])

  const fields = useFieldErrors({
    password: password ? null : 'Enter your current password',
    keyFile: hasKeyFile && !keyFileContents ? 'Choose your key file' : null
  })

  const target = KDF_LEVELS.find((l) => l.id === levelId)

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
    if (!target || !fields.submit()) return
    setLoading(true)
    onLockChange(true)
    // A rejected call must still release the lock, or the dialog could never be left.
    const res = await notvex.vault
      .changeKdfLevel(target.id, password, keyFileContents ?? undefined)
      .catch(() => ({ success: false as const, error: "Couldn't change the level. Try again." }))
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
        title="Key derivation"
        onBack={onBack}
        backDisabled={locked}
      />

      {step === 'choose' && (
        <div className="mt-2 space-y-4">
          <p className="text-muted-foreground text-xs">
            Changing the level also issues a new recovery key, and the current one stops working.
          </p>
          <KdfLevelPicker value={levelId} onChange={setLevelId} current={current} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onBack}>
              Cancel
            </Button>
            <Button disabled={levelId === current.id} onClick={() => setStep('confirm')}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 'confirm' && target && (
        <div className="mt-2 space-y-4">
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            Change from <Badge variant="secondary">{describeKdfLevel(current)}</Badge> to{' '}
            <Badge variant="secondary">{describeKdfLevel(target)}</Badge>
          </p>

          <Field data-invalid={!!fields.error('password')}>
            <FieldLabel htmlFor="kdf-password">Current password</FieldLabel>
            <PasswordInput
              id="kdf-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={fields.touch('password')}
              placeholder="Your current password"
              aria-invalid={!!fields.error('password')}
            />
            <FieldErrorSlot>{fields.error('password')}</FieldErrorSlot>
          </Field>

          {hasKeyFile && (
            <Field data-invalid={!!fields.error('keyFile')}>
              <FieldLabel>Key file</FieldLabel>
              <KeyFileInput
                onChange={(c) => setKeyFileContents(c)}
                onClear={() => setKeyFileContents(null)}
              />
              <FieldErrorSlot>{fields.error('keyFile')}</FieldErrorSlot>
            </Field>
          )}

          <Alert variant="warning">
            <AlertTriangleIcon />
            <AlertDescription>
              Notes are re-encrypted and a new recovery key replaces the current one. Keep Notvex
              open until it finishes.
            </AlertDescription>
          </Alert>

          <FieldError>{error}</FieldError>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onBack} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={loading}>
              {loading && <Spinner aria-hidden />}
              {loading ? 'Re-encrypting vault…' : 'Change level'}
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
            note="Delete any older copy of the recovery key, such as a printout or a file."
            confirmLabel="Done"
            onConfirm={finish}
          />
        </div>
      )}
    </div>
  )
}
