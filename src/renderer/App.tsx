import { useEffect } from 'react'
import { notvex } from './lib/ipc'
import { useVaultStore } from './store/vault.store'
import { Setup } from './views/Setup'
import { Unlock } from './views/Unlock'
import { Main } from './views/Main'

export default function App(): JSX.Element {
  const { status, setStatus } = useVaultStore()

  useEffect(() => {
    const init = async (): Promise<void> => {
      // Check if a vault exists at the stored path
      const hasVaultRes = await notvex.vault.hasVault()
      if (!hasVaultRes.success || !hasVaultRes.data) {
        setStatus('uninitialized')
        return
      }
      // Check if it's already open (shouldn't be on startup, but handle gracefully)
      const statusRes = await notvex.vault.status()
      if (statusRes.success && statusRes.data.isOpen) {
        setStatus('unlocked')
      } else {
        setStatus('locked')
      }
    }
    init()
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
