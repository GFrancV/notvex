import { useState } from 'react'
import { notvex } from '../lib/ipc'
import { passwordStrength } from '../lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Eye, EyeOff, Copy, Check, AlertTriangle } from 'lucide-react'

interface ChangePasswordDialogProps {
  open: boolean
  onClose: () => void
}

type Step = 'form' | 'mnemonic'

const STRENGTH_COLORS = {
  weak: 'bg-red-500',
  medium: 'bg-amber-500',
  strong: 'bg-emerald-500',
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
    if (ve) { setError(ve); return }
    setError(''); setLoading(true)
    const res = await notvex.vault.changePassword(currentPw, newPw)
    setLoading(false)
    if (!res.success) { setError(res.error); return }
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
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
    setShowCurrent(false); setShowNew(false); setShowConfirm(false)
    setError(''); setLoading(false)
    setMnemonic(''); setMnemonicCopied(false); setMnemonicConfirmed(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="bg-[#1a1a1a] border-[#2a2a2a] text-[#e5e5e5] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#e5e5e5]">
            {step === 'form' ? 'Change password' : 'Save your new recovery key'}
          </DialogTitle>
        </DialogHeader>

        {step === 'form' && (
          <div className="space-y-4 mt-2">
            {/* Current password */}
            <div className="space-y-1.5">
              <Label className="text-[#a3a3a3] text-xs">Current password</Label>
              <div className="relative">
                <Input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="Your current password"
                  className="pr-10 bg-[#111111] border-[#2a2a2a] text-[#e5e5e5]"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#a3a3a3]"
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div className="space-y-1.5">
              <Label className="text-[#a3a3a3] text-xs">New password</Label>
              <div className="relative">
                <Input
                  type={showNew ? 'text' : 'password'}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="At least 12 characters"
                  className="pr-10 bg-[#111111] border-[#2a2a2a] text-[#e5e5e5]"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#a3a3a3]"
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {/* Strength bar */}
              {newPw && (
                <div className="flex gap-1 mt-1">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= fillCount ? STRENGTH_COLORS[strength] : 'bg-[#2a2a2a]'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Confirm new password */}
            <div className="space-y-1.5">
              <Label className="text-[#a3a3a3] text-xs">Confirm new password</Label>
              <div className="relative">
                <Input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Repeat new password"
                  className="pr-10 bg-[#111111] border-[#2a2a2a] text-[#e5e5e5]"
                  onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#a3a3a3]"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1 border-[#2a2a2a] text-[#a3a3a3]" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={!canSubmit}>
                {loading ? 'Re-encrypting vault…' : 'Change password'}
              </Button>
            </div>
          </div>
        )}

        {step === 'mnemonic' && (
          <div className="space-y-4 mt-2">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-300">
                Your recovery key has changed. The previous key is no longer valid. Save this new one — it will not be shown again.
              </p>
            </div>

            <div className="relative rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] p-4">
              <p className="font-mono text-sm text-emerald-300 leading-relaxed break-all">{mnemonic}</p>
              <button
                onClick={copyMnemonic}
                className="absolute right-3 top-3 rounded p-1 text-[#737373] hover:text-[#e5e5e5] hover:bg-[#2a2a2a]"
              >
                {mnemonicCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-emerald-500"
                checked={mnemonicConfirmed}
                onChange={(e) => setMnemonicConfirmed(e.target.checked)}
              />
              <span className="text-sm text-[#a3a3a3]">
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
