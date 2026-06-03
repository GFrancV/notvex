import { useState, useEffect } from 'react'
import { notvex } from '../lib/ipc'
import { useVaultStore } from '../store/vault.store'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Shield, Eye, EyeOff, Key } from 'lucide-react'

export function Unlock(): JSX.Element {
  const { setStatus, refreshAll } = useVaultStore()

  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'password' | 'recovery'>('password')

  useEffect(() => {
    notvex.prefs.get('vaultPath').then((res) => {
      if (res.success && res.data) setVaultPath(res.data as string)
    })
  }, [])

  async function afterUnlock(): Promise<void> {
    await refreshAll()
    setStatus('unlocked')
  }

  const handlePasswordUnlock = async (): Promise<void> => {
    if (!vaultPath) return
    setError(''); setLoading(true)
    const res = await notvex.vault.open(vaultPath, password)
    setLoading(false)
    if (!res.success) { setError(res.error); return }
    if (!res.data) { setError('Incorrect password.'); return }
    await afterUnlock()
  }

  const handleRecoveryUnlock = async (): Promise<void> => {
    if (!vaultPath) return
    setError(''); setLoading(true)
    const res = await notvex.vault.openWithRecovery(vaultPath, mnemonic.trim())
    setLoading(false)
    if (!res.success) { setError(res.error); return }
    if (!res.data) { setError('Invalid recovery key.'); return }
    await afterUnlock()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111111] p-8">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-600/20 border border-emerald-600/30">
            <Shield className="h-7 w-7 text-emerald-400" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[#e5e5e5] tracking-tight">Notvex</h1>
            <p className="text-sm text-[#737373] mt-1">Unlock your vault</p>
          </div>
        </div>

        {vaultPath && (
          <p className="mb-4 text-xs text-[#737373] text-center truncate">
            {vaultPath}
          </p>
        )}

        <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setError('') }}>
          <TabsList className="w-full mb-6">
            <TabsTrigger value="password" className="flex-1 gap-1.5">
              <Key className="h-3.5 w-3.5" /> Password
            </TabsTrigger>
            <TabsTrigger value="recovery" className="flex-1 gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Recovery
            </TabsTrigger>
          </TabsList>

          {/* Password tab */}
          <TabsContent value="password" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="unlock-password">Master password</Label>
              <div className="relative">
                <Input
                  id="unlock-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="pr-10"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handlePasswordUnlock()}
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

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button className="w-full" onClick={handlePasswordUnlock} disabled={loading || !password}>
              {loading ? 'Unlocking…' : 'Unlock'}
            </Button>
          </TabsContent>

          {/* Recovery tab */}
          <TabsContent value="recovery" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mnemonic">24-word recovery key</Label>
              <textarea
                id="mnemonic"
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                placeholder="Enter your 24 recovery words separated by spaces..."
                className="flex min-h-[96px] w-full rounded-md border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-[#e5e5e5] font-mono placeholder:text-[#737373] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 resize-none"
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button
              className="w-full"
              onClick={handleRecoveryUnlock}
              disabled={loading || mnemonic.trim().split(/\s+/).length < 24}
            >
              {loading ? 'Unlocking…' : 'Unlock with recovery key'}
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
