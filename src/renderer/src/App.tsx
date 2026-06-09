import { type JSX, useEffect } from 'react'

import { notvex } from './lib/ipc'
import { useVaultStore } from './store/vault.store'
import { Main } from './views/main'
import { Setup } from './views/setup'
import { Unlock } from './views/unlock'

export default function App(): JSX.Element {
  const { status, setStatus } = useVaultStore()

  useEffect(() => {
    const init = async (): Promise<void> => {
      const prefsRes = await notvex.prefs.get('vaultPath')
      const prefsData = prefsRes.success ? prefsRes.data : null
      const savedPath = typeof prefsData === 'string' ? prefsData : null

      if (!savedPath) {
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
      <div className="flex h-screen items-center justify-center bg-[#111111]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#2a2a2a] border-t-emerald-500" />
      </div>
    )
  }

  if (status === 'uninitialized') return <Setup />
  if (status === 'locked') return <Unlock />
  return <Main />
}
