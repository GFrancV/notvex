import { useEffect, useState, type ReactNode } from 'react'

import { KeyFileInput } from '@/components/KeyFileInput'
import { PasswordInput } from '@/components/PasswordInput'
import { KEY_REPLACED, RecoveryKeyStep } from '@/components/RecoveryKeyStep'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useFieldErrors } from '@/hooks/use-field-errors'
import { notvex } from '@/lib/ipc'
import { useUiStore } from '@/store/ui.store'

// Mounted with Main, so it asks once per unlock and comes back on every unlock until the user
// confirms a key.
export function RecoveryKeyUnconfirmedDialog(): ReactNode {
  const [open, setOpen] = useState(false)
  const [hasKeyFile, setHasKeyFile] = useState(false)
  const [password, setPassword] = useState('')
  const [keyFileContents, setKeyFileContents] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  // Shared with Settings: Ctrl+L also waits on it (see settingsLocked).
  const locked = useUiStore((s) => s.settingsLocked)
  const setLocked = useUiStore((s) => s.setSettingsLocked)

  useEffect(() => {
    void notvex.vault.recoveryUnconfirmed().then(async (r) => {
      if (!r.success || !r.data) return
      const kf = await notvex.vault.getHasKeyFile()
      setHasKeyFile(kf.success ? kf.data : false)
      setOpen(true)
    })
  }, [])

  const fields = useFieldErrors({
    password: password ? null : 'Enter your password',
    keyFile: hasKeyFile && !keyFileContents ? 'Choose your key file' : null
  })

  const handleGenerate = async (): Promise<void> => {
    setError('')
    if (loading || !fields.submit()) return
    setLoading(true)
    setLocked(true)
    // A rejected call must still release the lock, or the dialog could never be left.
    const res = await notvex.vault
      .regenerateRecoveryKey(password, keyFileContents ?? undefined)
      .catch(() => ({ success: false as const, error: 'Something went wrong. Try again.' }))
    setLoading(false)
    if (!res.success) {
      setLocked(false)
      setError(res.error)
      return
    }
    setPassword('')
    setMnemonic(res.data.mnemonic)
  }

  const finish = (): void => {
    // See ChangePasswordPanel: a failed confirm only means the next unlock warns.
    void notvex.vault.confirmRecoverySaved().catch(() => undefined)
    setLocked(false)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (locked && !next ? undefined : setOpen(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your new recovery key was never confirmed</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          A new recovery key was created for this vault, but Notvex closed before you confirmed
          you&apos;d saved it. The previous key no longer works.
        </DialogDescription>

        {mnemonic === '' ? (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              If you didn&apos;t save it, generate a new one now. Your password stays the same.
            </p>
            <Field data-invalid={!!fields.error('password')}>
              <FieldLabel htmlFor="regenerate-password">Password</FieldLabel>
              <PasswordInput
                id="regenerate-password"
                autoFocus
                value={password}
                disabled={loading}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={fields.touch('password')}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') void handleGenerate()
                }}
                aria-invalid={!!fields.error('password')}
              />
              <FieldError>{fields.error('password')}</FieldError>
            </Field>
            {hasKeyFile && (
              <Field data-invalid={!!fields.error('keyFile')}>
                <FieldLabel>Key file</FieldLabel>
                <KeyFileInput
                  disabled={loading}
                  onChange={(c) => setKeyFileContents(c)}
                  onClear={() => setKeyFileContents(null)}
                />
                <FieldError>{fields.error('keyFile')}</FieldError>
              </Field>
            )}
            <FieldError>{error}</FieldError>
            <DialogFooter>
              <Button variant="ghost" disabled={loading} onClick={() => setOpen(false)}>
                Later
              </Button>
              <Button
                disabled={loading}
                onClick={(): void => {
                  void handleGenerate()
                }}
              >
                {loading && <Spinner aria-hidden />}
                {loading ? 'Re-encrypting vault…' : 'Generate new recovery key'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <RecoveryKeyStep
              mnemonic={mnemonic}
              context={KEY_REPLACED}
              confirmLabel="Done"
              onConfirm={finish}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
