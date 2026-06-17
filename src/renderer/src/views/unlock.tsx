import { type ReactNode, useEffect, useRef, useState } from 'react'

import { EyeIcon, EyeOffIcon, FolderOpenIcon } from 'lucide-react'

import { AppLogo } from '@/components/AppLogo'
import { KeyFileInput } from '@/components/KeyFileInput'
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
import type { UnlockThrottleStatus } from '@shared/types'

type UnlockMode = 'password' | 'recovery'

function truncatePath(path: string, maxLen = 54): string {
  if (path.length <= maxLen) return path
  const half = Math.floor((maxLen - 3) / 2)
  return path.slice(0, half) + '…' + path.slice(path.length - half)
}

export function Unlock(): ReactNode {
  const { setStatus, setNeedsRecoveryReset, setPendingNewVaultPath, refreshAll } = useVaultStore()

  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [hasKeyFile, setHasKeyFile] = useState(false)
  const [keyFileContents, setKeyFileContents] = useState<Uint8Array | null>(null)
  const [recoveryKeyFileContents, setRecoveryKeyFileContents] = useState<Uint8Array | null>(null)
  const [mode, setMode] = useState<UnlockMode>('password')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [pathError, setPathError] = useState('')
  const [loading, setLoading] = useState(false)
  const [throttle, setThrottle] = useState<UnlockThrottleStatus | null>(null)
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startCountdown(seconds: number): void {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(seconds)
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!)
          countdownRef.current = null
          setThrottle((t) => (t ? { ...t, isThrottled: false, waitSeconds: 0 } : t))
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function refreshThrottleStatus(): Promise<void> {
    const t = await notvex.vault.getUnlockThrottleStatus()
    if (!t.success) return
    setThrottle(t.data)
    if (t.data.isThrottled && t.data.waitSeconds > 0) {
      startCountdown(t.data.waitSeconds)
    }
  }

  useEffect(() => {
    void (async (): Promise<void> => {
      const res = await notvex.prefs.get('vaultPath')
      const data = res.success ? res.data : null
      const path = typeof data === 'string' ? data : null
      setVaultPath(path)
      if (path) {
        const check = await notvex.vault.hasVault(path)
        const exists = check.success && check.data
        setVaultExists(exists)
        if (exists) {
          const kfRes = await notvex.vault.hasKeyFile()
          setHasKeyFile(kfRes.success ? kfRes.data : false)
          await refreshThrottleStatus()
        }
      } else {
        setVaultExists(false)
      }
    })()
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function afterUnlock(viaRecovery = false): Promise<void> {
    await refreshAll()
    if (viaRecovery) setNeedsRecoveryReset(true)
    setStatus('unlocked')
  }

  const handlePasswordUnlock = async (): Promise<void> => {
    if (!vaultPath) return
    if (countdown > 0) return
    setError('')
    setLoading(true)
    const res = await notvex.vault.open(vaultPath, password, keyFileContents ?? undefined)
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      await refreshThrottleStatus()
      return
    }
    if (!res.data) {
      const errMsg = hasKeyFile ? 'Incorrect password or key file.' : 'Incorrect password.'
      setError(errMsg)
      await refreshThrottleStatus()
      return
    }
    await afterUnlock()
  }

  const handleRecoveryUnlock = async (): Promise<void> => {
    if (!vaultPath) return
    setError('')
    setLoading(true)
    const res = await notvex.vault.openWithRecovery(
      vaultPath,
      mnemonic.trim(),
      hasKeyFile ? (recoveryKeyFileContents ?? undefined) : undefined
    )
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    if (!res.data) {
      setError(hasKeyFile ? 'Invalid recovery key or key file.' : 'Invalid recovery key.')
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
    const kfRes = await notvex.vault.hasKeyFile()
    setHasKeyFile(kfRes.success ? kfRes.data : false)
    setKeyFileContents(null)
    setRecoveryKeyFileContents(null)
    await refreshThrottleStatus()
  }

  const handleCreateNew = async (): Promise<void> => {
    const res = await notvex.vault.chooseFile('new')
    if (!res.success || !res.data) return
    // Setup mounts on the password step with this path; its "Back to unlock" returns here
    setPendingNewVaultPath(res.data)
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
  const isThrottled = countdown > 0

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center p-8">
      <div className="titlebar-drag absolute top-0 right-0 left-0 h-11" />
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <AppLogo />
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
          <div className="mx-auto mb-5 text-center">
            <Button
              variant="outline"
              onClick={handleOpenOther}
              className="text-muted mx-auto text-xs"
            >
              <FolderOpenIcon />

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>{truncatePath(vaultPath)}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{vaultPath}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Button>

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
              onClick={(): void => {
                void handleCreateNew()
              }}
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
                        if (e.key === 'Enter' && !isThrottled) void handlePasswordUnlock()
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton onClick={() => setShowPassword((v) => !v)}>
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>

                {hasKeyFile && (
                  <Field>
                    <FieldLabel>Key file</FieldLabel>
                    <KeyFileInput
                      onChange={(c) => setKeyFileContents(c)}
                      onClear={() => setKeyFileContents(null)}
                    />
                  </Field>
                )}

                {error && !isThrottled && <p className="text-destructive text-sm">{error}</p>}

                {isThrottled && (
                  <div className="space-y-1">
                    <p className="text-destructive text-sm">
                      Too many failed attempts. Please wait {countdown} second
                      {countdown !== 1 ? 's' : ''} before trying again.
                    </p>
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className="bg-destructive h-full rounded-full transition-all duration-1000"
                        style={{
                          width: `${throttle ? (countdown / throttle.waitSeconds) * 100 : 0}%`
                        }}
                      />
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={(): void => {
                    void handlePasswordUnlock()
                  }}
                  disabled={loading || !password || isThrottled || (hasKeyFile && !keyFileContents)}
                >
                  {loading ? 'Unlocking…' : 'Unlock'}
                </Button>

                <p className="text-center">
                  <button
                    type="button"
                    onClick={switchToRecovery}
                    className="text-muted-foreground text-xs hover:underline"
                  >
                    Forgot your password? <span className="text-foreground">Use recovery key</span>
                  </button>
                </p>

                <p className="text-center">
                  <Button
                    variant="link"
                    className="text-muted h-auto p-0 text-xs font-normal"
                    onClick={(): void => {
                      void handleCreateNew()
                    }}
                  >
                    Create a new vault
                  </Button>
                </p>
              </>
            ) : (
              <>
                <p className="text-muted text-sm">
                  Enter your 24 recovery words to regain access to your vault.
                </p>

                {hasKeyFile && (
                  <Field>
                    <FieldLabel>Key file</FieldLabel>
                    <KeyFileInput
                      onChange={(c) => setRecoveryKeyFileContents(c)}
                      onClear={() => setRecoveryKeyFileContents(null)}
                    />
                  </Field>
                )}

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
                      <span
                        className={`block text-right text-xs ${wordCount === 24 ? 'text-primary' : 'text-destructive'}`}
                      >
                        {wordCount}/24 words
                      </span>
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
                  disabled={loading || wordCount !== 24 || (hasKeyFile && !recoveryKeyFileContents)}
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
