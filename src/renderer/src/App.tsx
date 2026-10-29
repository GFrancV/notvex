import { type ReactNode, useEffect } from 'react'

import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { DevBuildWarningDialog } from '@/components/dialogs/DevBuildWarningDialog'
import { MigrationRequiredDialog } from '@/components/dialogs/MigrationRequiredDialog'
import { ReloadWindowDialog } from '@/components/dialogs/ReloadWindowDialog'
import { UpdateAvailableDialog } from '@/components/dialogs/UpdateAvailableDialog'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { useClipboardGuard } from '@/hooks/use-clipboard-guard'
import { notvex } from '@/lib/ipc'
import { TOOLTIP_DELAY } from '@/lib/utils'
import { usePrefsStore } from '@/store/prefs.store'
import { useVaultStore } from '@/store/vault.store'
import { Main } from '@/views/main'
import { PostRecoveryReset } from '@/views/post-recovery-reset'
import { Setup } from '@/views/setup'
import { Unlock } from '@/views/unlock'

export default function App(): ReactNode {
  const { setStatus, setCurrentVaultPath, setPendingOpenVaultPath, clearSession } = useVaultStore()
  const { status, needsRecoveryReset, pendingNewVaultPath } = useVaultStore(
    useShallow((s) => ({
      status: s.status,
      needsRecoveryReset: s.needsRecoveryReset,
      pendingNewVaultPath: s.pendingNewVaultPath
    }))
  )

  const { load: loadPrefs } = usePrefsStore()

  useClipboardGuard()

  useEffect(() => {
    const init = async (): Promise<void> => {
      await loadPrefs()

      // Consume any file path queued from process.argv / OS open-file event
      const pendingRes = await notvex.vault.getPendingFile()
      const pendingFilePath = pendingRes.success ? pendingRes.data : null
      if (pendingFilePath) {
        setPendingOpenVaultPath(pendingFilePath)
        setStatus('locked')
        return
      }

      const lastOpenedVaultPath = usePrefsStore.getState().recentVaults[0]?.path ?? null

      if (!lastOpenedVaultPath) {
        setStatus('uninitialized')
        return
      }

      // Check if it's already open (shouldn't be on startup, but handle gracefully)
      const statusRes = await notvex.vault.status()
      if (statusRes.success && statusRes.data.isOpen) {
        setCurrentVaultPath(statusRes.data.vaultPath)
        setStatus('unlocked')
      } else {
        // Unlock view handles the "file missing" case internally
        setStatus('locked')
      }
    }

    void init()
  }, [setStatus, setCurrentVaultPath, loadPrefs, setPendingOpenVaultPath])

  // Subscribe to vault:open-file push events (second-instance / open-file while running).
  // Main has already closed any open vault by the time this arrives.
  useEffect(() => {
    return notvex.onOpenFile((filePath) => {
      clearSession()
      setPendingOpenVaultPath(filePath)
    })
  }, [clearSession, setPendingOpenVaultPath])

  // Lives here, not in Main: an unlocked session can also be showing PostRecoveryReset
  useEffect(() => notvex.onAutoLocked(clearSession), [clearSession])

  // Lives here, not in Main: Main unmounts when the vault locks, which is when this fires
  useEffect(() => {
    return notvex.onPackFailed(() => {
      toast.error("Recent changes couldn't be saved when the vault was locked.")
    })
  }, [])

  if (status === 'checking') {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <Spinner className="text-primary size-6" />
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY}>
      {pendingNewVaultPath || status === 'uninitialized' ? (
        <Setup />
      ) : status === 'locked' ? (
        <Unlock />
      ) : needsRecoveryReset ? (
        <PostRecoveryReset />
      ) : (
        <Main />
      )}
      <Toaster position="bottom-right" />
      <UpdateAvailableDialog />
      <MigrationRequiredDialog />
      <DevBuildWarningDialog />
      <ReloadWindowDialog />
    </TooltipProvider>
  )
}
