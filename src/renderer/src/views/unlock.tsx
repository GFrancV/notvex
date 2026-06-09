import { type JSX, useEffect, useState } from 'react'

import { EyeIcon, EyeOffIcon, FolderOpenIcon, ShieldIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { notvex } from '@/lib/ipc'
import { useVaultStore } from '@/store/vault.store'

type UnlockMode = 'password' | 'recovery'

function truncatePath(path: string, maxLen = 54): string {
  if (path.length <= maxLen) return path
  const half = Math.floor((maxLen - 3) / 2)
  return path.slice(0, half) + '…' + path.slice(path.length - half)
}

export function Unlock(): JSX.Element {
  const { setStatus, setNeedsRecoveryReset, refreshAll } = useVaultStore()

  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [mode, setMode] = useState<UnlockMode>('password')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [pathError, setPathError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void (async (): Promise<void> => {
      const res = await notvex.prefs.get('vaultPath')
      const data = res.success ? res.data : null
      const path = typeof data === 'string' ? data : null
      setVaultPath(path)
      if (path) {
        const check = await notvex.vault.hasVault(path)
        setVaultExists(check.success && check.data)
      } else {
        setVaultExists(false)
      }
    })()
  }, [])

  async function afterUnlock(viaRecovery = false): Promise<void> {
    await refreshAll()
    if (viaRecovery) setNeedsRecoveryReset(true)
    setStatus('unlocked')
  }

  const handlePasswordUnlock = async (): Promise<void> => {
    if (!vaultPath) return
    setError('')
    setLoading(true)
    const res = await notvex.vault.open(vaultPath, password)
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    if (!res.data) {
      setError('Incorrect password.')
      return
    }
    await afterUnlock()
  }

  const handleRecoveryUnlock = async (): Promise<void> => {
    if (!vaultPath) return
    setError('')
    setLoading(true)
    const res = await notvex.vault.openWithRecovery(vaultPath, mnemonic.trim())
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    if (!res.data) {
      setError('Invalid recovery key.')
      return
    }
    await afterUnlock(true)
  }

  const handleOpenOther = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('existing')
    if (!res.success || !res.data) return
    const selected = res.data
    const check = await notvex.vault.hasVault(selected)
    if (!check.success || !check.data) {
      setPathError('This file is not a valid Notvex vault')
      return
    }
    await notvex.prefs.set('vaultPath', selected)
    setVaultPath(selected)
    setPathError('')
    setVaultExists(true)
    setError('')
  }

  const switchToRecovery = (): void => {
    setMode('recovery')
    setError('')
  }

  const switchToPassword = (): void => {
    setMode('password')
    setError('')
  }

  const words = mnemonic.trim() === '' ? [] : mnemonic.trim().split(/\s+/)
  const wordCount = words.length

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="border-primary/20 bg-primary/15 flex h-14 w-14 items-center justify-center rounded-xl border">
            <ShieldIcon className="text-primary h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Notvex</h1>
            <p className="text-muted mt-1 text-sm">
              {vaultExists === true && mode === 'recovery'
                ? 'Account Recovery'
                : 'Unlock your vault'}
            </p>
          </div>
        </div>

        {/* Vault selector */}
        {vaultPath && (
          <div className="mb-5">
            <div className="flex items-center justify-between gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted cursor-default text-xs">
                      {truncatePath(vaultPath)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{vaultPath}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="outline"
                size="sm"
                className="text-muted hover:text-foreground shrink-0"
                onClick={(): void => {
                  void handleOpenOther()
                }}
              >
                <FolderOpenIcon />
                <span className="sr-only">Open other</span>
              </Button>
            </div>
            {pathError && <p className="text-destructive mt-1 text-xs">✕ {pathError}</p>}
          </div>
        )}

        {/* Checking */}
        {vaultExists === null && (
          <div className="flex justify-center py-8">
            <div className="border-t-primary border-border h-6 w-6 animate-spin rounded-full border-2" />
          </div>
        )}

        {/* Vault file not found */}
        {vaultExists === false && (
          <div className="space-y-4 rounded-lg border p-4">
            <p className="text-muted text-sm">
              The vault file could not be found at the saved location.
            </p>
            <Button
              variant="ghost"
              className="w-full"
              onClick={(): void => setStatus('uninitialized')}
            >
              Create new vault
            </Button>
          </div>
        )}

        {/* Unlock form */}
        {vaultExists === true && (
          <div
            key={mode}
            className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-4 duration-200"
          >
            {mode === 'password' ? (
              <>
                <Field>
                  <FieldLabel htmlFor="unlock-password">Master password</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="unlock-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      onKeyDown={(e): void => {
                        if (e.key === 'Enter') void handlePasswordUnlock()
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton onClick={() => setShowPassword((v) => !v)}>
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>

                {error && <p className="text-destructive text-sm">{error}</p>}

                <Button
                  className="w-full"
                  onClick={(): void => {
                    void handlePasswordUnlock()
                  }}
                  disabled={loading || !password}
                >
                  {loading ? 'Unlocking…' : 'Unlock'}
                </Button>

                <p className="text-center">
                  <button
                    type="button"
                    onClick={switchToRecovery}
                    className="text-muted text-xs hover:underline"
                  >
                    Forgot your password? Use recovery key
                  </button>
                </p>
              </>
            ) : (
              <>
                <p className="text-muted text-sm">
                  Enter your 24 recovery words to regain access to your vault.
                </p>

                <Field>
                  <Textarea
                    value={mnemonic}
                    onChange={(e) => setMnemonic(e.target.value)}
                    placeholder="Enter your 24-word recovery phrase…"
                    rows={4}
                    className="h-26 resize-none font-mono"
                  />
                  <FieldDescription>
                    {mnemonic.trim() !== '' && (
                      <p
                        className={`text-right text-xs ${wordCount === 24 ? 'text-primary' : 'text-destructive'}`}
                      >
                        {wordCount}/24 words
                      </p>
                    )}
                    <p className="text-muted text-xs">
                      Separate each word with a space or new line.
                    </p>
                  </FieldDescription>
                </Field>

                {error && <p className="text-destructive text-sm">{error}</p>}

                <Button
                  className="w-full"
                  onClick={(): void => {
                    void handleRecoveryUnlock()
                  }}
                  disabled={loading || wordCount !== 24}
                >
                  {loading ? 'Recovering…' : 'Recover Access'}
                </Button>

                <p className="text-center">
                  <button
                    type="button"
                    onClick={switchToPassword}
                    className="text-muted text-xs hover:underline"
                  >
                    ← Back to unlock
                  </button>
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
