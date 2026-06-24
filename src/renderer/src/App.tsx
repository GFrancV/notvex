import { type ReactNode, useEffect } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { notvex } from '@/lib/ipc'
import { useVaultStore } from '@/store/vault.store'
import { Main } from '@/views/main'
import { PostRecoveryReset } from '@/views/post-recovery-reset'
import { Setup } from '@/views/setup'
import { Unlock } from '@/views/unlock'

export default function App(): ReactNode {
  const { status, needsRecoveryReset, pendingNewVaultPath, setStatus } = useVaultStore()

  useEffect(() => {
    const init = async (): Promise<void> => {
      const currentPathRes = await notvex.prefs.getCurrentVaultPath()
      const currentVaultPath = currentPathRes.success ? currentPathRes.data : null

      if (currentVaultPath === null) {
        setStatus('uninitialized')
        return
      }

      // Check if it's already open (shouldn't be on startup, but handle gracefully)
      const statusRes = await notvex.vault.status()
      if (statusRes.success && statusRes.data.isOpen) {
        setStatus('unlocked')
      } else {
        // Unlock view handles the "file missing" case internally
        setStatus('locked')
      }
    }
    void init()
  }, [setStatus])

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
