import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { useUiStore } from '@/store/ui.store'

export async function reloadWindow(): Promise<void> {
  const res = await notvex.app.reloadWindow()
  if (!res.success) toast.error(res.error)
}

// Reloading locks the vault, so an open one asks first. Main is asked rather than the store:
// Setup's recovery step has the vault open while the store still says it isn't.
export async function requestReload(): Promise<void> {
  const res = await notvex.vault.status()
  if (res.success && !res.data.isOpen) {
    await reloadWindow()
    return
  }
  useUiStore.getState().setReloadConfirmOpen(true)
}
