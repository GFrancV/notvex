import { type ReactNode, useEffect } from 'react'

import { useShallow } from 'zustand/react/shallow'

import { MigrationRequiredDialog } from '@/components/dialogs/MigrationRequiredDialog'
import { UpdateAvailableDialog } from '@/components/dialogs/UpdateAvailableDialog'
import { Toaster } from '@/components/ui/sonner'
import { notvex } from '@/lib/ipc'
import { usePrefsStore } from '@/store/prefs.store'
import { useVaultStore } from '@/store/vault.store'
import { Main } from '@/views/main'
import { PostRecoveryReset } from '@/views/post-recovery-reset'
import { Setup } from '@/views/setup'
import { Unlock } from '@/views/unlock'

export default function App(): ReactNode {
  const { setStatus, setCurrentVaultPath, setPendingOpenVaultPath } = useVaultStore()
  const { status, needsRecoveryReset, pendingNewVaultPath } = useVaultStore(
    useShallow((s) => ({
      status: s.status,
      needsRecoveryReset: s.needsRecoveryReset,
      pendingNewVaultPath: s.pendingNewVaultPath
    }))
  )

  const { load: loadPrefs } = usePrefsStore()

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

  // Subscribe to vault:open-file push events (second-instance / open-file while running)
  useEffect(() => {
    return notvex.onOpenFile((filePath) => {
      setPendingOpenVaultPath(filePath)
      setStatus('locked')
    })
  }, [setStatus, setPendingOpenVaultPath])

  if (status === 'checking') {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="border-border border-t-primary h-6 w-6 animate-spin rounded-full border-2" />
      </div>
    )
  }

  return (
    <>
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
    </>
  )
}
