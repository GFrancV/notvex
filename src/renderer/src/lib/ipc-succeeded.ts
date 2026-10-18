import { toast } from 'sonner'

import type { IpcResult } from '@shared/types'

/**
 * Toasts a failed call and resolves whether it succeeded. The invoke itself can reject, not
 * just return a failure, so a rejection toasts `fallback`.
 */
export async function ipcSucceeded(
  call: Promise<IpcResult<unknown>>,
  fallback: string
): Promise<boolean> {
  const res = await call.catch(() => ({ success: false as const, error: fallback }))
  if (!res.success) toast.error(res.error)
  return res.success
}
