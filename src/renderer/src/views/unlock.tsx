import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { ChevronDownIcon, EyeIcon, EyeOffIcon, FolderOpenIcon, Loader2Icon } from 'lucide-react'

import { AppLogo } from '@/components/AppLogo'
import { KeyFileInput } from '@/components/KeyFileInput'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { usePickVault } from '@/hooks/use-pick-vault'
import { notvex } from '@/lib/ipc'
import { truncatePath } from '@/lib/utils'
import { usePrefsStore } from '@/store/prefs.store'
import { useVaultStore } from '@/store/vault.store'
import type { UnlockThrottleStatus } from '@shared/types'

type UnlockMode = 'password' | 'recovery'

export function Unlock(): ReactNode {
  const {
    setStatus,
    setNeedsRecoveryReset,
    setPendingNewVaultPath,
    refreshAll,
    setVaultVersion,
    setCurrentVaultPath,
    setPendingOpenVaultPath
  } = useVaultStore()
  const pendingOpenVaultPath = useVaultStore((s) => s.pendingOpenVaultPath)

  const { pickExistingVault } = usePickVault()

  // Prefs already loaded by App.tsx before Unlock mounts — reads are synchronous
  const lastOpenedVaultPath = usePrefsStore((s) => s.recentVaults[0]?.path ?? null)

  const initialPath = pendingOpenVaultPath ?? lastOpenedVaultPath
  const [vaultPath, setVaultPath] = useState<string | null>(initialPath)
  const [vaultExists, setVaultExists] = useState<boolean>(initialPath !== null)
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    initialPath !== null ? usePrefsStore.getState().getHasKeyFileForPath(initialPath) : false
  )
  const [mode, setMode] = useState<UnlockMode>('password')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [throttle, setThrottle] = useState<UnlockThrottleStatus | null>(null)
  const [countdown, setCountdown] = useState(0)

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const keyFileContentsRef = useRef<Uint8Array | null>(null)
  const recoveryKeyFileContentsRef = useRef<Uint8Array | null>(null)
  const pendingPathRef = useRef(pendingOpenVaultPath)

  const startCountdown = useCallback((seconds: number): void => {
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
  }, [])

  const refreshThrottleStatus = useCallback(async (): Promise<void> => {
    const t = await notvex.vault.getUnlockThrottleStatus()
    if (!t.success) return
    setThrottle(t.data)
    if (t.data.isThrottled && t.data.waitSeconds > 0) {
      startCountdown(t.data.waitSeconds)
    }
  }, [startCountdown])

  // Init: clear pending path from store + fetch throttle status
  useEffect(() => {
    void (async (): Promise<void> => {
      if (pendingPathRef.current) {
        setPendingOpenVaultPath(null)
      }

      if (!vaultPath) return

      await refreshThrottleStatus()
    })()
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshThrottleStatus, setPendingOpenVaultPath])

  // React to vault:open-file push events while Unlock is already mounted (Scenario B)
  useEffect(() => {
    if (!pendingOpenVaultPath) return
    void (async (): Promise<void> => {
      setVaultPath(pendingOpenVaultPath)
      setVaultExists(true)
      setAdvancedOpen(usePrefsStore.getState().getHasKeyFileForPath(pendingOpenVaultPath))
      setError('')
      setPassword('')
      setMnemonic('')
      keyFileContentsRef.current = null
      recoveryKeyFileContentsRef.current = null
      setPendingOpenVaultPath(null)
      await refreshThrottleStatus()
    })()
  }, [pendingOpenVaultPath, refreshThrottleStatus, setPendingOpenVaultPath])

  async function afterUnlock(viaRecovery = false): Promise<void> {
    await Promise.all([refreshAll(), usePrefsStore.getState().load()])
    if (viaRecovery) setNeedsRecoveryReset(true)
    setCurrentVaultPath(vaultPath)
    setStatus('unlocked')
  }

  const handleUnlockVault = async (): Promise<void> => {
    if (!vaultPath) return
    if (countdown > 0) return
    setError('')
    setLoading(true)
    const res = await notvex.vault.open(
      vaultPath,
      password,
      keyFileContentsRef.current ?? undefined
    )
    setLoading(false)
    if (!res.success) {
      // User declined the vault-format update prompt — not a credential failure,
      // so return to an idle unlock form instead of showing an error.
      if (res.error === 'MIGRATION_CANCELLED') return
      setError(res.error)
      await refreshThrottleStatus()
      return
    }
    if (res.data === null) {
      setError('Incorrect password or key file.')
      await refreshThrottleStatus()
      return
    }
    setVaultVersion(res.data)
    await afterUnlock()
  }

  const handleRecoveryUnlock = async (): Promise<void> => {
    if (!vaultPath) return
    setError('')
    setLoading(true)
    const res = await notvex.vault.openWithRecovery(
      vaultPath,
      mnemonic.trim(),
      recoveryKeyFileContentsRef.current ?? undefined
    )
    setLoading(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    if (res.data === null) {
      setError('Invalid recovery key or key file.')
      return
    }
    setVaultVersion(res.data)
    await afterUnlock(true)
  }

  const handleOpenOther = async (): Promise<void> => {
    const selectedPath = await pickExistingVault()
    if (selectedPath === null) return

    setVaultPath(selectedPath)
    setAdvancedOpen(usePrefsStore.getState().getHasKeyFileForPath(selectedPath))
    setVaultExists(true)
    setError('')
    keyFileContentsRef.current = null
    recoveryKeyFileContentsRef.current = null
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
          </div>
        )}

        {/* Vault file not found */}
        {vaultExists === false && (
          <div className="space-y-4 rounded-lg border p-4">
            <p className="text-muted-foreground text-sm">
              The vault file could not be found at the saved location.
            </p>

            <div className="space-y-4">
              <Button
                className="w-full"
                onClick={(): void => {
                  void handleCreateNew()
                }}
              >
                Create new vault
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="border-border w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-background text-muted px-2">or</span>
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={handleOpenOther}>
                Open existing vault
              </Button>
            </div>
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
                        if (e.key === 'Enter' && !isThrottled) void handleUnlockVault()
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton onClick={() => setShowPassword((v) => !v)}>
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>

                <Collapsible
                  open={advancedOpen}
                  onOpenChange={setAdvancedOpen}
                  className="rounded-md border-0 transition duration-300 data-[state=open]:border"
                >
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="group w-full justify-start">
                      Advanced options
                      <ChevronDownIcon className="ml-auto transition-transform duration-300 group-data-[state=open]:rotate-180" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 py-4">
                    <Field>
                      <FieldLabel>Key file</FieldLabel>
                      <KeyFileInput
                        onChange={(c) => (keyFileContentsRef.current = c)}
                        onClear={() => (keyFileContentsRef.current = null)}
                      />
                    </Field>
                  </CollapsibleContent>
                </Collapsible>

                {error && !isThrottled && <p className="text-destructive text-sm">{error}</p>}

                {isThrottled && (
                  <div className="space-y-1">
                    <p className="text-destructive text-sm">
                      Too many failed attempts. Please wait {countdown} second
                      {countdown !== 1 ? 's' : ''} before trying again.
                    </p>
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className="bg-destructive h-full w-(--throttle-w,0%) rounded-full transition-all duration-1000"
                        style={
                          {
                            '--throttle-w': `${throttle ? (countdown / throttle.waitSeconds) * 100 : 0}%`
                          } as CSSProperties
                        }
                      />
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleUnlockVault}
                  disabled={loading || !password || isThrottled}
                >
                  {loading ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Unlocking…
                    </>
                  ) : (
                    'Unlock'
                  )}
                </Button>

                <p className="text-center">
                  <Button
                    variant="link"
                    size="sm"
                    type="button"
                    onClick={switchToRecovery}
                    className="text-muted-foreground h-auto p-0 text-xs"
                  >
                    Forgot your password? <span className="text-foreground">Use recovery key</span>
                  </Button>
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

                <Collapsible
                  open={advancedOpen}
                  onOpenChange={setAdvancedOpen}
                  className="rounded-md border-0 transition duration-300 data-[state=open]:border"
                >
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="group w-full justify-start">
                      Advanced options
                      <ChevronDownIcon className="ml-auto transition-transform duration-300 group-data-[state=open]:rotate-180" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 py-4">
                    <Field>
                      <FieldLabel>Key file</FieldLabel>
                      <KeyFileInput
                        onChange={(c) => (recoveryKeyFileContentsRef.current = c)}
                        onClear={() => (recoveryKeyFileContentsRef.current = null)}
                      />
                    </Field>
                  </CollapsibleContent>
                </Collapsible>

                {error && <p className="text-destructive text-sm">{error}</p>}

                <Button
                  className="w-full"
                  onClick={(): void => {
                    void handleRecoveryUnlock()
                  }}
                  disabled={loading || wordCount !== 24}
                >
                  {loading ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Recovering…
                    </>
                  ) : (
                    'Recover Access'
                  )}
                </Button>

                <p className="text-center">
                  <Button
                    variant="link"
                    size="sm"
                    type="button"
                    onClick={switchToPassword}
                    className="text-muted h-auto p-0 text-xs"
                  >
                    ← Back to unlock
                  </Button>
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
