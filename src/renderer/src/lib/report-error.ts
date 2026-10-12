import { notvex } from '@/lib/ipc'

// Called from the error path itself (window.onerror, the ErrorBoundary), so it can never throw.
// Only name and stack are sent; main strips the message from the stack before it is written.
export function reportError(e: unknown): void {
  try {
    const payload =
      e instanceof Error
        ? { name: String(e.name), stack: typeof e.stack === 'string' ? e.stack : '' }
        : { name: 'NonError', stack: '' }
    notvex.log.error(payload).catch(() => undefined)
  } catch {
    /* nothing left to report to */
  }
}
