import { type JSX, useState } from 'react'

import { AlertTriangleIcon, Check, Copy, EyeIcon, EyeOffIcon } from 'lucide-react'

import { notvex } from '../lib/ipc'
import { passwordStrength } from '../lib/utils'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, FieldDescription, FieldLabel } from './ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'

interface ChangePasswordDialogProps {
  open: boolean
  onClose: () => void
}

type Step = 'form' | 'mnemonic'

const STRENGTH_COLORS = {
  weak: 'bg-red-500',
  medium: 'bg-amber-500',
  strong: 'bg-emerald-500'
}

const STRENGTH_FILL = { weak: 1, medium: 2, strong: 3 }

export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps): JSX.Element {
  const [step, setStep] = useState<Step>('form')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [mnemonicCopied, setMnemonicCopied] = useState(false)
  const [mnemonicConfirmed, setMnemonicConfirmed] = useState(false)

  const strength = passwordStrength(newPw)
  const fillCount = STRENGTH_FILL[strength]

  const validationError = (): string => {
    if (!currentPw || !newPw || !confirmPw) return 'All fields are required'
    if (newPw.length < 12) return 'New password must be at least 12 characters'
    if (newPw === currentPw) return 'New password must differ from the current one'
    if (newPw !== confirmPw) return 'New passwords do not match'
    return ''
  }

  const canSubmit = !loading && !validationError()

  const handleSubmit = async (): Promise<void> => {
    const ve = validationError()
    if (ve) {
      setError(ve)
      return
    }
    setError('')
    setLoading(true)
    const res = await notvex.vault.changePassword(currentPw, newPw)
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setMnemonic(res.data.mnemonic)
    setStep('mnemonic')
  }

  const copyMnemonic = async (): Promise<void> => {
    await navigator.clipboard.writeText(mnemonic)
    setMnemonicCopied(true)
    setTimeout(() => setMnemonicCopied(false), 2000)
  }

  const handleClose = (): void => {
    setStep('form')
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    setShowCurrent(false)
    setShowNew(false)
    setShowConfirm(false)
    setError('')
    setLoading(false)
    setMnemonic('')
    setMnemonicCopied(false)
    setMnemonicConfirmed(false)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'form' ? 'Change password' : 'Save your new recovery key'}
          </DialogTitle>
        </DialogHeader>

        {step === 'form' && (
          <div className="mt-2 space-y-4">
            {/* Current password */}
            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="current-password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  type={showCurrent ? 'text' : 'password'}
                  placeholder="Your current password"
                />
                <InputGroupAddon align="inline-end">
                  <Button variant="ghost" size="sm" onClick={() => setShowCurrent((v) => !v)}>
                    {showCurrent ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            </Field>

            {/* New password */}
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  type={showNew ? 'text' : 'password'}
                  placeholder="At least 12 characters"
                />
                <InputGroupAddon align="inline-end">
                  <Button variant="ghost" size="sm" onClick={() => setShowNew((v) => !v)}>
                    {showNew ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </InputGroupAddon>
              </InputGroup>
              {newPw && (
                <FieldDescription>
                  <div className="mt-1 flex gap-1">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i <= fillCount ? STRENGTH_COLORS[strength] : 'bg-[#2a2a2a]'
                        }`}
                      />
                    ))}
                  </div>
                </FieldDescription>
              )}
            </Field>

            {/* Confirm new password */}
            <Field>
              <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="confirm-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Repeat new password"
                  onKeyDown={(e): void => {
                    if (e.key === 'Enter' && canSubmit) void handleSubmit()
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <Button variant="ghost" size="sm" onClick={() => setShowConfirm((v) => !v)}>
                    {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            </Field>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={(): void => {
                  void handleSubmit()
                }}
                disabled={!canSubmit}
              >
                {loading ? 'Re-encrypting vault…' : 'Change password'}
              </Button>
            </div>
          </div>
        )}

        {step === 'mnemonic' && (
          <div className="mt-2 space-y-4">
            <Alert className="border border-amber-500/30 bg-amber-500/10">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <AlertDescription className="text-amber-300">
                Your recovery key has changed. The previous key is no longer valid. Save this new
                one — it will not be shown again.
              </AlertDescription>
            </Alert>

            <div className="relative rounded-lg border bg-[#0f0f0f] p-4">
              <p className="text-primary pr-5.5 font-mono text-sm leading-relaxed break-all">
                {mnemonic}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={(): void => {
                  void copyMnemonic()
                }}
                className="absolute top-1 right-1"
              >
                {mnemonicCopied ? <Check className="text-primary" /> : <Copy />}
              </Button>
            </div>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="accent-primary mt-0.5"
                checked={mnemonicConfirmed}
                onChange={(e) => setMnemonicConfirmed(e.target.checked)}
              />
              <span className="text-muted-foreground text-sm">
                I have saved my new recovery key in a secure location.
              </span>
            </label>

            <Button className="w-full" disabled={!mnemonicConfirmed} onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
