import { type ReactNode, useEffect } from 'react'

import { useShallow } from 'zustand/react/shallow'

import { Toaster } from '@/components/ui/sonner'
import { notvex } from '@/lib/ipc'
import { usePrefsStore } from '@/store/prefs.store'
import { useVaultStore } from '@/store/vault.store'
import { Main } from '@/views/main'
import { PostRecoveryReset } from '@/views/post-recovery-reset'
import { Setup } from '@/views/setup'
import { Unlock } from '@/views/unlock'

export default function App(): ReactNode {
  const { setStatus, setCurrentVaultPath } = useVaultStore()
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
  }, [setStatus, setCurrentVaultPath, loadPrefs])

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
    </>
  )
}
