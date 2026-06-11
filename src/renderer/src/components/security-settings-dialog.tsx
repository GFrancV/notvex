import { type JSX, useEffect, useState } from 'react'

import {
  AlertTriangleIcon,
  CheckIcon,
  FileKeyIcon,
  KeyIcon,
  ShieldCheckIcon,
  ShieldOffIcon
} from 'lucide-react'

import { notvex } from '@/lib/ipc'
import { KeyFileInput } from './KeyFileInput'
import { RecoveryWordsGrid } from './recovery-words-grid'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Separator } from './ui/separator'

interface Props {
  open: boolean
  onClose: () => void
}

type KeyFileStep =
  | 'idle'
  | 'confirm-activate'
  | 'activating'
  | 'post-activate-mnemonic'
  | 'confirm-remove'
  | 'removing'
  | 'post-remove-mnemonic'

export function SecuritySettingsDialog({ open, onClose }: Props): JSX.Element {
  const [lockOnMinimize, setLockOnMinimize] = useState(false)
  const [allowScreenCapture, setAllowScreenCapture] = useState(false)
  const [hasKeyFile, setHasKeyFile] = useState(false)

  const [keyFileStep, setKeyFileStep] = useState<KeyFileStep>('idle')
  const [pendingKeyFilePassword, setPendingKeyFilePassword] = useState('')
  const [pendingKeyFileError, setPendingKeyFileError] = useState('')
  const [pendingKeyFileLoading, setPendingKeyFileLoading] = useState(false)

  const [pendingKeyFileContents, setPendingKeyFileContents] = useState<Uint8Array | null>(null)
  const [pendingKeyFilename, setPendingKeyFilename] = useState<string | null>(null)
  const [removeKeyFileContents, setRemoveKeyFileContents] = useState<Uint8Array | null>(null)
  const [removeKeyFilename, setRemoveKeyFilename] = useState<string | null>(null)
  const [removePassword, setRemovePassword] = useState('')
  const [removeError, setRemoveError] = useState('')
  const [removeLoading, setRemoveLoading] = useState(false)

  const [pendingMnemonic, setPendingMnemonic] = useState('')
  const [mnemonicConfirmed, setMnemonicConfirmed] = useState(false)

  useEffect(() => {
    if (!open) return
    void (async (): Promise<void> => {
      const prefs = await notvex.prefs.get()
      if (prefs.success && prefs.data && typeof prefs.data === 'object') {
        const p = prefs.data as { lockOnMinimize?: boolean; allowScreenCapture?: boolean }
        setLockOnMinimize(p.lockOnMinimize ?? false)
        setAllowScreenCapture(p.allowScreenCapture ?? false)
      }
      const kf = await notvex.vault.hasKeyFile()
      setHasKeyFile(kf.success ? kf.data : false)
    })()
  }, [open])

  const handleLockOnMinimize = (checked: boolean): void => {
    setLockOnMinimize(checked)
    void notvex.prefs.set('lockOnMinimize', checked)
  }

  const handleAllowScreenCapture = (checked: boolean): void => {
    setAllowScreenCapture(checked)
    void notvex.prefs.set('allowScreenCapture', checked)
  }

  const handleGenerateKeyFile = async (): Promise<void> => {
    const res = await notvex.vault.generateKeyFile()
    if (!res.success || !res.data) return
    setPendingKeyFileContents(res.data.contents)
    setPendingKeyFilename(res.data.filename)
    setPendingKeyFilePassword('')
    setPendingKeyFileError('')
    setKeyFileStep('confirm-activate')
  }

  const handleChooseKeyFile = async (): Promise<void> => {
    const res = await notvex.vault.selectKeyFile()
    if (!res.success || !res.data || res.data.sizeBytes === 0) return
    setPendingKeyFileContents(res.data.contents)
    setPendingKeyFilename(res.data.filename)
    setPendingKeyFilePassword('')
    setPendingKeyFileError('')
    setKeyFileStep('confirm-activate')
  }

  const handleActivateKeyFile = async (): Promise<void> => {
    if (!pendingKeyFileContents || !pendingKeyFilePassword) return
    setPendingKeyFileLoading(true)
    setPendingKeyFileError('')
    const res = await notvex.vault.configureKeyFile(pendingKeyFilePassword, pendingKeyFileContents)
    setPendingKeyFileLoading(false)
    if (!res.success) {
      setPendingKeyFileError(res.error)
      return
    }
    setHasKeyFile(true)
    setPendingKeyFileContents(null)
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
    const res = await notvex.vault.removeKeyFile(removePassword, removeKeyFileContents)
    setRemoveLoading(false)
    if (!res.success) {
      setRemoveError(res.error)
      return
    }
    setHasKeyFile(false)
    setRemoveKeyFileContents(null)
    setRemoveKeyFilename(null)
    setRemovePassword('')
    setPendingMnemonic(res.data.mnemonic)
    setMnemonicConfirmed(false)
    setKeyFileStep('post-remove-mnemonic')
  }

  const cancelKeyFileStep = (): void => {
    setKeyFileStep('idle')
    setPendingKeyFileContents(null)
    setPendingKeyFilename(null)
    setPendingKeyFilePassword('')
    setPendingKeyFileError('')
    setRemoveKeyFileContents(null)
    setRemoveKeyFilename(null)
    setRemovePassword('')
    setRemoveError('')
    setPendingMnemonic('')
    setMnemonicConfirmed(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Security settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* ── Auto-lock ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Auto-lock
            </p>

            <SettingRow
              label="Lock when minimized"
              description="Lock the vault when the app window is minimized."
            >
              <Checkbox
                checked={lockOnMinimize}
                onCheckedChange={(v) => handleLockOnMinimize(v === true)}
              />
            </SettingRow>

            <SettingRow
              label="Lock on system sleep"
              description="Always active. Cannot be disabled."
              readonly
            >
              <ReadonlyCheck />
            </SettingRow>

            <SettingRow
              label="Lock on screen lock"
              description="Always active. Cannot be disabled."
              readonly
            >
              <ReadonlyCheck />
            </SettingRow>
          </section>

          <Separator />

          {/* ── Privacy ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Privacy
            </p>

            <SettingRow
              label="Prevent screen capture"
              description="Hides Notvex from screenshots and screen sharing. Requires restart."
            >
              <Checkbox
                checked={allowScreenCapture ? false : true}
                onCheckedChange={(v) => handleAllowScreenCapture(v !== true)}
              />
            </SettingRow>
          </section>

          <Separator />

          {/* ── Key file ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Key file
            </p>

            <p className="text-muted-foreground text-xs">
              A key file adds a second factor to unlock your vault. You need both your password and
              the key file to access your notes. If you lose the key file, access is permanently
              lost.
            </p>

            {keyFileStep === 'idle' && (
              <>
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
                    onClick={() => {
                      setKeyFileStep('confirm-remove')
                      setRemoveKeyFileContents(null)
                      setRemoveKeyFilename(null)
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
              <div className="space-y-3 rounded-md border p-3">
                <Alert className="border-warning/30 bg-warning/10 border">
                  <AlertTriangleIcon className="stroke-warning mt-0.5 h-4 w-4 shrink-0" />
                  <AlertDescription className="text-xs text-amber-300">
                    Adding a key file will change your vault encryption.
                    <br />
                    Your current recovery codes will be <strong>invalidated</strong> and new ones
                    will be generated. You must save them.
                  </AlertDescription>
                </Alert>
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs">
                    File: <span className="font-mono">{pendingKeyFilename ?? ''}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Any file up to 1MB. Larger files will use only the first 1MB. For best security,
                    use a generated .nvxkey file.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setKeyFileStep('activating')}>
                    Continue
                  </Button>
                  <Button variant="ghost" size="sm" onClick={cancelKeyFileStep}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {keyFileStep === 'activating' && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Activate key file</p>
                <p className="text-muted-foreground text-xs">
                  File: <span className="font-mono">{pendingKeyFilename ?? ''}</span>
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="kf-password" className="text-xs">
                    Current password
                  </Label>
                  <Input
                    id="kf-password"
                    type="password"
                    value={pendingKeyFilePassword}
                    onChange={(e) => setPendingKeyFilePassword(e.target.value)}
                    placeholder="Enter your password to confirm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleActivateKeyFile()
                    }}
                  />
                </div>
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
                  <Button variant="ghost" size="sm" onClick={cancelKeyFileStep}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {keyFileStep === 'post-activate-mnemonic' && (
              <div className="space-y-3">
                <Alert className="border-warning/30 bg-warning/10 border">
                  <AlertTriangleIcon className="stroke-warning mt-0.5 h-4 w-4 shrink-0" />
                  <AlertDescription className="text-xs text-amber-300">
                    Key file activated. Your recovery key has changed — save it now. It won&apos;t
                    be shown again.
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
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!mnemonicConfirmed}
                  onClick={cancelKeyFileStep}
                >
                  Done
                </Button>
              </div>
            )}

            {keyFileStep === 'confirm-remove' && (
              <div className="space-y-3 rounded-md border p-3">
                <Alert className="border-destructive/30 bg-destructive/10 border">
                  <AlertTriangleIcon className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
                  <AlertDescription className="text-destructive text-xs">
                    Removing the key file will change your vault encryption.
                    <br />
                    Your current recovery codes will be <strong>invalidated</strong> and new ones
                    will be generated. After removal your vault will be protected by your password
                    only.
                  </AlertDescription>
                </Alert>
                <div className="space-y-1.5">
                  <Label className="text-xs">Key file</Label>
                  <KeyFileInput
                    value={removeKeyFilename}
                    onChange={(c, f) => {
                      setRemoveKeyFileContents(c)
                      setRemoveKeyFilename(f)
                    }}
                    onClear={() => {
                      setRemoveKeyFileContents(null)
                      setRemoveKeyFilename(null)
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rm-password" className="text-xs">
                    Password
                  </Label>
                  <Input
                    id="rm-password"
                    type="password"
                    value={removePassword}
                    onChange={(e) => setRemovePassword(e.target.value)}
                    placeholder="Enter your password"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRemoveKeyFile()
                    }}
                  />
                </div>
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
                  <Button variant="ghost" size="sm" onClick={cancelKeyFileStep}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {keyFileStep === 'post-remove-mnemonic' && (
              <div className="space-y-3">
                <Alert className="border-warning/30 bg-warning/10 border">
                  <AlertTriangleIcon className="stroke-warning mt-0.5 h-4 w-4 shrink-0" />
                  <AlertDescription className="text-xs text-amber-300">
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
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!mnemonicConfirmed}
                  onClick={cancelKeyFileStep}
                >
                  Done
                </Button>
              </div>
            )}
          </section>

          <Separator />

          {/* ── Unlock attempts ── */}
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Unlock attempts
            </p>

            <SettingRow
              label="Progressive delay after failed unlock attempts"
              description="Always active. Cannot be disabled."
              readonly
            >
              <ReadonlyCheck />
            </SettingRow>
          </section>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

function SettingRow({
  label,
  description,
  readonly = false,
  children
}: {
  label: string
  description?: string
  readonly?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 space-y-0.5">
        <p className={`text-sm ${readonly ? 'text-muted-foreground' : ''}`}>{label}</p>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className="mt-0.5 shrink-0">{children}</div>
    </div>
  )
}

function ReadonlyCheck(): JSX.Element {
  return (
    <div className="bg-primary/20 border-primary/30 flex h-4 w-4 items-center justify-center rounded border">
      <CheckIcon className="text-primary h-3 w-3" />
    </div>
  )
}
