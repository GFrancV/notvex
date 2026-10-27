import { useEffect, useState, type ReactNode } from 'react'

import { AlertTriangleIcon } from 'lucide-react'

import { KeyFileInput } from '@/components/KeyFileInput'
import { PasswordInput } from '@/components/PasswordInput'
import { RecoveryWordsGrid } from '@/components/recovery-words-grid'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
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
  const [mnemonicConfirmed, setMnemonicConfirmed] = useState(false)
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

  const canSubmit = !loading && password !== '' && (!hasKeyFile || keyFileContents !== null)

  const handleGenerate = async (): Promise<void> => {
    setError('')
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
            <Field>
              <FieldLabel htmlFor="regenerate-password">Password</FieldLabel>
              <PasswordInput
                id="regenerate-password"
                autoFocus
                value={password}
                disabled={loading}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter' && canSubmit) void handleGenerate()
                }}
              />
            </Field>
            {hasKeyFile && (
              <Field>
                <FieldLabel>Key file</FieldLabel>
                <KeyFileInput
                  disabled={loading}
                  onChange={(c) => setKeyFileContents(c)}
                  onClear={() => setKeyFileContents(null)}
                />
              </Field>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" disabled={loading} onClick={() => setOpen(false)}>
                Later
              </Button>
              <Button
                disabled={!canSubmit}
                onClick={(): void => {
                  void handleGenerate()
                }}
              >
                {loading ? 'Re-encrypting vault…' : 'Generate new recovery key'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert variant="warning">
              <AlertTriangleIcon />
              <AlertDescription>
                Write it down by hand or copy it on a device you trust, and keep it somewhere safe.
                It won&apos;t be shown again.
              </AlertDescription>
            </Alert>

            <RecoveryWordsGrid mnemonic={mnemonic} />

            <Field orientation="horizontal">
              <Checkbox
                id="regenerate-confirm-recovery"
                checked={mnemonicConfirmed}
                onCheckedChange={(c) => setMnemonicConfirmed(c === true)}
              />
              <FieldLabel htmlFor="regenerate-confirm-recovery">
                I&apos;ve saved my new recovery key somewhere safe.
              </FieldLabel>
            </Field>

            <Button className="w-full" disabled={!mnemonicConfirmed} onClick={finish}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
