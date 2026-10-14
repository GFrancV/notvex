import { notvex } from '@/lib/ipc'
import { toErrorLike } from '@shared/error-stack'

// Called from the error path itself (window.onerror, the ErrorBoundary), so it can never throw.
// The message is cut here too, so it never crosses IPC; main still filters what it receives.
export function reportError(e: unknown): void {
  try {
    notvex.log.error(toErrorLike(e)).catch(() => undefined)
  } catch {
    /* nothing left to report to */
  }
}
