import { useState, type ReactNode } from 'react'

import { AlertTriangleIcon } from 'lucide-react'

import { KeyFileInput } from '@/components/KeyFileInput'
import { PasswordInput } from '@/components/PasswordInput'
import { KEY_REPLACED, RecoveryKeyStep } from '@/components/RecoveryKeyStep'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { useFieldErrors } from '@/hooks/use-field-errors'
import { notvex } from '@/lib/ipc'
import { SubpageHeader } from './SettingRow'

export type KeyFileMode =
  { kind: 'add'; contents: Uint8Array; filename: string; sizeBytes: number } | { kind: 'remove' }

interface KeyFilePanelProps {
  mode: KeyFileMode
  onBack: () => void
  onHasKeyFileChange: (hasKeyFile: boolean) => void
  /** True while leaving would discard the new recovery key; see SettingsDialog. */
  onLockChange: (locked: boolean) => void
}

// One step per change: the consequences sit next to the button that commits it, then the new
// recovery key. Mounted only while the subpage is open, so leaving it discards every field.
export function KeyFilePanel({
  mode,
  onBack,
  onHasKeyFileChange,
  onLockChange
}: KeyFilePanelProps): ReactNode {
  const adding = mode.kind === 'add'
  const [password, setPassword] = useState('')
  const [keyFile, setKeyFile] = useState<Uint8Array | null>(
    mode.kind === 'add' ? mode.contents : null
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mnemonic, setMnemonic] = useState('')

  const fields = useFieldErrors({
    keyFile: keyFile ? null : 'Choose your key file',
    password: password ? null : 'Enter your current password'
  })
  const submitLabel = adding
    ? { idle: 'Activate', busy: 'Activating…' }
    : { idle: 'Remove', busy: 'Removing…' }

  const handleSubmit = async (): Promise<void> => {
    if (loading || !fields.submit() || !keyFile) return
    setLoading(true)
    setError('')
    onLockChange(true)
    // A rejected call must still release the lock, or the dialog could never be left.
    const res = await (
      adding
        ? notvex.vault.configureKeyFile(password, keyFile)
        : notvex.vault.removeKeyFile(password, keyFile)
    ).catch(() => ({ success: false as const, error: 'Something went wrong. Try again.' }))
    setLoading(false)
    if (!res.success) {
      onLockChange(false)
      setError(res.error)
      return
    }
    onHasKeyFileChange(adding)
    setPassword('')
    setKeyFile(null)
    setMnemonic(res.data.mnemonic)
  }

  // Main has already re-keyed the vault by the time the mnemonic arrives, so it must be seen.
  const locked = loading || mnemonic !== ''

  const finish = (): void => {
    // See ChangePasswordPanel: a failed confirm only means the next unlock warns.
    void notvex.vault.confirmRecoverySaved().catch(() => undefined)
    onLockChange(false)
    onBack()
  }

  return (
    <div className="space-y-4">
      <SubpageHeader
        parent="Security"
        title={adding ? 'Add key file' : 'Remove key file'}
        onBack={onBack}
        backDisabled={locked}
      />

      {mnemonic === '' ? (
        <>
          <Alert variant={adding ? 'warning' : 'destructive'}>
            <AlertTriangleIcon />
            <AlertDescription>
              <p>
                {adding ? 'Adding' : 'Removing'} a key file changes your vault encryption. Your
                current recovery codes will be <strong>invalidated</strong> and new ones generated,
                which you must save.{' '}
                {adding
                  ? 'From then on you need both your password and this file to unlock; if you lose the file, access is lost for good.'
                  : 'After removal your vault is protected by your password only.'}
              </p>
            </AlertDescription>
          </Alert>

          <Field data-invalid={!!fields.error('keyFile')}>
            <FieldLabel>Key file</FieldLabel>
            <KeyFileInput
              initialFile={
                mode.kind === 'add'
                  ? { filename: mode.filename, sizeBytes: mode.sizeBytes }
                  : undefined
              }
              onChange={(contents) => setKeyFile(contents)}
              onClear={() => setKeyFile(null)}
              autoFocus={!adding}
            />
            {adding && (
              <p className="text-muted-foreground text-xs">
                Any file up to 1MB; larger files use only the first 1MB. For best security, use a
                generated .nvxkey file.
              </p>
            )}
            <FieldError>{fields.error('keyFile')}</FieldError>
          </Field>

          <Field data-invalid={!!fields.error('password')}>
            <FieldLabel htmlFor="kf-password">Current password</FieldLabel>
            <PasswordInput
              id="kf-password"
              autoFocus={adding}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={fields.touch('password')}
              placeholder="Enter your password to confirm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit()
              }}
              aria-invalid={!!fields.error('password')}
            />
            <FieldError>{fields.error('password')}</FieldError>
          </Field>

          <FieldError>{error}</FieldError>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} disabled={loading}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={adding ? 'default' : 'destructive'}
              disabled={loading}
              onClick={() => void handleSubmit()}
            >
              {loading ? submitLabel.busy : submitLabel.idle}
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <h3 className="font-semibold">Save your new recovery key</h3>
          <RecoveryKeyStep
            mnemonic={mnemonic}
            context={`Key file ${adding ? 'activated' : 'removed'}. ${KEY_REPLACED}`}
            confirmLabel="Done"
            onConfirm={finish}
          />
        </div>
      )}
    </div>
  )
}
