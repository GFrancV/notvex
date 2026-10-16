import { useRef, useState, type ReactNode } from 'react'

import {
  AlertTriangleIcon,
  FileKeyIcon,
  KeyIcon,
  ShieldCheckIcon,
  ShieldOffIcon
} from 'lucide-react'

import { KeyFileInput } from '@/components/KeyFileInput'
import { PasswordInput } from '@/components/PasswordInput'
import { RecoveryWordsGrid } from '@/components/recovery-words-grid'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { notvex } from '@/lib/ipc'
import { SubpageHeader } from './SettingRow'

type KeyFileStep =
  | 'idle'
  | 'confirm-activate'
  | 'activating'
  | 'post-activate-mnemonic'
  | 'confirm-remove'
  | 'removing'
  | 'post-remove-mnemonic'

interface KeyFilePanelProps {
  onBack: () => void
  hasKeyFile: boolean
  onHasKeyFileChange: (hasKeyFile: boolean) => void
  /** True while leaving would discard the new recovery key; see SettingsDialog. */
  onLockChange: (locked: boolean) => void
}

// Mounted only while the subpage is open, so leaving it discards the pending key file and mnemonic.
export function KeyFilePanel({
  onBack,
  hasKeyFile,
  onHasKeyFileChange,
  onLockChange
}: KeyFilePanelProps): ReactNode {
  const pendingKeyFileContentsRef = useRef<Uint8Array | null>(null)
  const [keyFileStep, setKeyFileStep] = useState<KeyFileStep>('idle')
  const [pendingKeyFileError, setPendingKeyFileError] = useState('')
  const [pendingKeyFileLoading, setPendingKeyFileLoading] = useState(false)
  const [pendingKeyFilename, setPendingKeyFilename] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [removeLoading, setRemoveLoading] = useState(false)
  const [pendingMnemonic, setPendingMnemonic] = useState('')
  const [mnemonicConfirmed, setMnemonicConfirmed] = useState(false)
  const [pendingKeyFilePassword, setPendingKeyFilePassword] = useState('')
  const [removeKeyFileContents, setRemoveKeyFileContents] = useState<Uint8Array | null>(null)
  const [removePassword, setRemovePassword] = useState('')

  const handleGenerateKeyFile = async (): Promise<void> => {
    const res = await notvex.vault.generateKeyFile()
    if (!res.success || !res.data) return

    pendingKeyFileContentsRef.current = res.data.contents
    setPendingKeyFilename(res.data.filename)
    setPendingKeyFilePassword('')
    setPendingKeyFileError('')
    setKeyFileStep('confirm-activate')
  }

  const handleChooseKeyFile = async (): Promise<void> => {
    const res = await notvex.vault.selectKeyFile()
    if (!res.success || !res.data || res.data.sizeBytes === 0) return

    pendingKeyFileContentsRef.current = res.data.contents
    setPendingKeyFilename(res.data.filename)
    setPendingKeyFilePassword('')
    setPendingKeyFileError('')
    setKeyFileStep('confirm-activate')
  }

  const handleActivateKeyFile = async (): Promise<void> => {
    if (!pendingKeyFileContentsRef.current || !pendingKeyFilePassword) return
    setPendingKeyFileLoading(true)
    setPendingKeyFileError('')
    onLockChange(true)
    const res = await notvex.vault.configureKeyFile(
      pendingKeyFilePassword,
      pendingKeyFileContentsRef.current
    )
    setPendingKeyFileLoading(false)
    if (!res.success) {
      onLockChange(false)
      setPendingKeyFileError(res.error)
      return
    }
    pendingKeyFileContentsRef.current = null
    onHasKeyFileChange(true)
    setPendingKeyFilename(null)
    setPendingKeyFilePassword('')
    setPendingMnemonic(res.data.mnemonic)
    setMnemonicConfirmed(false)
    setKeyFileStep('post-activate-mnemonic')
  }

  const handleRemoveKeyFile = async (): Promise<void> => {
    if (!removeKeyFileContents || !removePassword) return
    setRemoveLoading(true)
    setRemoveError('')
    onLockChange(true)
    const res = await notvex.vault.removeKeyFile(removePassword, removeKeyFileContents)
    setRemoveLoading(false)
    if (!res.success) {
      onLockChange(false)
      setRemoveError(res.error)
      return
    }
    onHasKeyFileChange(false)
    setRemoveKeyFileContents(null)
    setRemovePassword('')
    setPendingMnemonic(res.data.mnemonic)
    setMnemonicConfirmed(false)
    setKeyFileStep('post-remove-mnemonic')
  }

  // Main has already re-keyed the vault by the time the mnemonic arrives, so it must be seen.
  const locked =
    pendingKeyFileLoading ||
    removeLoading ||
    keyFileStep === 'post-activate-mnemonic' ||
    keyFileStep === 'post-remove-mnemonic'

  const finish = (): void => {
    onLockChange(false)
    onBack()
  }

  return (
    <div className="space-y-2">
      <SubpageHeader parent="Security" title="Key file" onBack={onBack} backDisabled={locked} />

      <div className="mt-2 space-y-4">
        {keyFileStep === 'idle' && (
          <>
            <p className="text-muted-foreground text-xs">
              A key file adds a second factor to unlock your vault. You need both your password and
              the key file to access your notes. If you lose the key file, access is permanently
              lost.
            </p>
            <div className="flex items-center gap-2">
              {hasKeyFile ? (
                <ShieldCheckIcon className="text-primary h-4 w-4" />
              ) : (
                <ShieldOffIcon className="text-muted-foreground h-4 w-4" />
              )}
              <span className="text-sm">{hasKeyFile ? 'Configured' : 'Not configured'}</span>
            </div>

            {!hasKeyFile ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  autoFocus
                  onClick={(): void => void handleGenerateKeyFile()}
                >
                  <FileKeyIcon className="h-3.5 w-3.5" />
                  Generate key file
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(): void => void handleChooseKeyFile()}
                >
                  <KeyIcon className="h-3.5 w-3.5" />
                  Use existing file
                </Button>
              </div>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                autoFocus
                onClick={() => {
                  setKeyFileStep('confirm-remove')
                  setRemoveKeyFileContents(null)
                  setRemovePassword('')
                  setRemoveError('')
                }}
              >
                Remove key file
              </Button>
            )}
          </>
        )}

        {keyFileStep === 'confirm-activate' && (
          <div className="space-y-3">
            <Alert className="border-warning/30 bg-warning/10 border">
              <AlertTriangleIcon className="stroke-warning mt-0.5 h-4 w-4 shrink-0" />
              <AlertDescription className="text-warning text-xs">
                Adding a key file will change your vault encryption.
                <br />
                Your current recovery codes will be <strong>invalidated</strong> and new ones will
                be generated. You must save them.
              </AlertDescription>
            </Alert>
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">
                File: <span className="font-mono">{pendingKeyFilename ?? ''}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                Any file up to 1MB. Larger files will use only the first 1MB. For best security, use
                a generated .nvxkey file.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setKeyFileStep('activating')}>
                Continue
              </Button>
              <Button variant="ghost" size="sm" onClick={onBack}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {keyFileStep === 'activating' && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Activate key file</p>
            <p className="text-muted-foreground text-xs">
              File: <span className="font-mono">{pendingKeyFilename ?? ''}</span>
            </p>
            <Field>
              <FieldLabel htmlFor="kf-password" className="text-xs">
                Current password
              </FieldLabel>
              <PasswordInput
                id="kf-password"
                value={pendingKeyFilePassword}
                onChange={(e) => setPendingKeyFilePassword(e.target.value)}
                placeholder="Enter your password to confirm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleActivateKeyFile()
                }}
              />
            </Field>
            {pendingKeyFileError && (
              <p className="text-destructive text-xs">{pendingKeyFileError}</p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={(): void => void handleActivateKeyFile()}
                disabled={pendingKeyFileLoading || !pendingKeyFilePassword}
              >
                {pendingKeyFileLoading ? 'Activating…' : 'Activate'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onBack} disabled={pendingKeyFileLoading}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {keyFileStep === 'post-activate-mnemonic' && (
          <div className="space-y-3">
            <h3 className="font-semibold">Save your new recovery key</h3>
            <Alert className="border-warning/30 bg-warning/10 border">
              <AlertTriangleIcon className="stroke-warning mt-0.5 h-4 w-4 shrink-0" />
              <AlertDescription className="text-warning text-xs">
                Key file activated. Your recovery key has changed — save it now. It won&apos;t be
                shown again.
              </AlertDescription>
            </Alert>
            <RecoveryWordsGrid mnemonic={pendingMnemonic} />
            <Field orientation="horizontal">
              <Checkbox
                id="kf-activate-confirm"
                checked={mnemonicConfirmed}
                onCheckedChange={(c) => setMnemonicConfirmed(c === true)}
              />
              <FieldLabel htmlFor="kf-activate-confirm" className="text-xs">
                I have saved my new recovery key in a secure location.
              </FieldLabel>
            </Field>
            <Button size="sm" className="w-full" disabled={!mnemonicConfirmed} onClick={finish}>
              Done
            </Button>
          </div>
        )}

        {keyFileStep === 'confirm-remove' && (
          <div className="space-y-3">
            <Alert className="border-destructive/30 bg-destructive/10 border">
              <AlertTriangleIcon className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
              <AlertDescription className="text-destructive text-xs">
                Removing the key file will change your vault encryption.
                <br />
                Your current recovery codes will be <strong>invalidated</strong> and new ones will
                be generated. After removal your vault will be protected by your password only.
              </AlertDescription>
            </Alert>
            <div className="space-y-1.5">
              <Label className="text-xs">Key file</Label>
              <KeyFileInput
                onChange={(c) => setRemoveKeyFileContents(c)}
                onClear={() => setRemoveKeyFileContents(null)}
              />
            </div>
            <Field>
              <FieldLabel htmlFor="rm-password" className="text-xs">
                Password
              </FieldLabel>
              <PasswordInput
                id="rm-password"
                value={removePassword}
                onChange={(e) => setRemovePassword(e.target.value)}
                placeholder="Enter your password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRemoveKeyFile()
                }}
              />
            </Field>
            {removeError && <p className="text-destructive text-xs">{removeError}</p>}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={(): void => void handleRemoveKeyFile()}
                disabled={!removeKeyFileContents || !removePassword || removeLoading}
              >
                {removeLoading ? 'Removing…' : 'Remove'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onBack} disabled={removeLoading}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {keyFileStep === 'post-remove-mnemonic' && (
          <div className="space-y-3">
            <h3 className="font-semibold">Save your new recovery key</h3>
            <Alert className="border-warning/30 bg-warning/10 border">
              <AlertTriangleIcon className="stroke-warning mt-0.5 h-4 w-4 shrink-0" />
              <AlertDescription className="text-warning text-xs">
                Key file removed. Your recovery key has changed — save it now. It won&apos;t be
                shown again.
              </AlertDescription>
            </Alert>
            <RecoveryWordsGrid mnemonic={pendingMnemonic} />
            <Field orientation="horizontal">
              <Checkbox
                id="kf-remove-confirm"
                checked={mnemonicConfirmed}
                onCheckedChange={(c) => setMnemonicConfirmed(c === true)}
              />
              <FieldLabel htmlFor="kf-remove-confirm" className="text-xs">
                I have saved my new recovery key in a secure location.
              </FieldLabel>
            </Field>
            <Button size="sm" className="w-full" disabled={!mnemonicConfirmed} onClick={finish}>
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
