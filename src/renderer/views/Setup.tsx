import { useState } from 'react'
import { notvex } from '../lib/ipc'
import { useVaultStore } from '../store/vault.store'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Shield, FolderOpen, Copy, Check, Eye, EyeOff } from 'lucide-react'

type Step = 'location' | 'password' | 'recovery'

export function Setup(): JSX.Element {
  const setStatus = useVaultStore((s) => s.setStatus)

  const [step, setStep] = useState<Step>('location')
  const [vaultPath, setVaultPath] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [mnemonicCopied, setMnemonicCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChooseFile = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('new')
    if (res.success && res.data) setVaultPath(res.data)
  }

  const handleCreate = async (): Promise<void> => {
    setError('')
    if (password.length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const res = await notvex.vault.create(vaultPath, password)
    setLoading(false)
    if (!res.success) { setError(res.error); return }
    setMnemonic(res.data.mnemonic)
    setStep('recovery')
  }

  const copyMnemonic = async (): Promise<void> => {
    await navigator.clipboard.writeText(mnemonic)
    setMnemonicCopied(true)
    setTimeout(() => setMnemonicCopied(false), 2000)
  }

  const handleFinish = (): void => {
    setStatus('unlocked')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111111] p-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-600/20 border border-emerald-600/30">
            <Shield className="h-7 w-7 text-emerald-400" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[#e5e5e5] tracking-tight">Notvex</h1>
            <p className="text-sm text-[#737373] mt-1">Create your secure vault</p>
          </div>
        </div>

        {/* Step: Location */}
        {step === 'location' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>Vault file</Label>
              <div className="flex gap-2">
                <Input
                  value={vaultPath ? vaultPath.split(/[\\/]/).pop()! : ''}
                  placeholder="Choose where to save..."
                  readOnly
                  title={vaultPath}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={handleChooseFile}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-[#737373]">
                Your vault will be saved as a single <code className="text-emerald-400">.nvx</code> file. Copy it to back up everything.
              </p>
            </div>

            <Button
              className="w-full"
              disabled={!vaultPath}
              onClick={() => setStep('password')}
            >
              Continue
            </Button>
          </div>
        )}

        {/* Step: Password */}
        {step === 'password' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-3">
              <p className="text-xs text-[#737373]">
                <span className="text-[#a3a3a3]">File:</span> {vaultPath}
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Master password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 12 characters"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#a3a3a3]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep('location')}>
                Back
              </Button>
              <Button className="flex-1" onClick={handleCreate} disabled={loading}>
                {loading ? 'Creating vault…' : 'Create vault'}
              </Button>
            </div>

            <p className="text-xs text-[#737373] text-center">
              This derives your encryption key using Argon2id. May take a few seconds.
            </p>
          </div>
        )}

        {/* Step: Recovery key */}
        {step === 'recovery' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-300 font-medium mb-1">Save your recovery key</p>
              <p className="text-xs text-amber-300/70">
                If you lose your password, this is the only way to recover your notes. Write it down or store it in a password manager. It will never be shown again.
              </p>
            </div>

            <div className="space-y-2">
              <div className="relative rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] p-4">
                <p className="font-mono text-sm text-emerald-300 leading-relaxed break-all">{mnemonic}</p>
                <button
                  onClick={copyMnemonic}
                  className="absolute right-3 top-3 rounded p-1 text-[#737373] hover:text-[#e5e5e5] hover:bg-[#2a2a2a]"
                >
                  {mnemonicCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-emerald-500"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span className="text-sm text-[#a3a3a3]">
                I have saved my recovery key in a secure location. I understand that if I lose both my password and this key, my notes are irrecoverable.
              </span>
            </label>

            <Button className="w-full" disabled={!confirmed} onClick={handleFinish}>
              Start using Notvex
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
