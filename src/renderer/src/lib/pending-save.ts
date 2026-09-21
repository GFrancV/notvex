/**
 * Debounced save that can be *flushed* instead of cancelled.
 *
 * A plain `setTimeout` debounce keeps the pending value inside the timer, so
 * `clearTimeout` silently throws away whatever was typed last (issue #19).
 * Here the pending value lives outside the timer, so it can always be drained.
 *
 * Live instances register themselves in a module-level set, which lets the
 * main process drain every editor on `vault:will-lock` without threading refs
 * through the component tree.
 */

type Commit = (id: string, value: string) => Promise<void>

export interface PendingSave {
  /** (Re)arms the debounce, replacing any value still pending. */
  schedule(id: string, value: string): void
  /** Cancels the timer and persists whatever was pending. Resolves once committed. */
  flush(): Promise<void>
  /** Unregisters the instance and drops the pending value without committing it. */
  dispose(): void
}

const liveSavers = new Set<PendingSave>()

export function createPendingSave(commit: Commit, delayMs: number): PendingSave {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { id: string; value: string } | null = null
  // A commit already handed to the caller and not yet resolved. Tracked
  // separately from `pending`, because a write in flight is no longer pending
  // but is very much not finished.
  let inFlight: Promise<void> | null = null

  // Reads `pending`, never any outside state: the value is persisted against the
  // id captured at schedule() time. Resolving it later would write note A's text
  // into whichever note happens to be open by then.
  //
  // Deliberately not async — starting a write and waiting for one are separate
  // jobs, and flush() needs them separately.
  const startCommit = (): void => {
    const entry = pending
    if (!entry) return
    pending = null
    inFlight = commit(entry.id, entry.value).finally(() => {
      inFlight = null
    })
  }

  const saver: PendingSave = {
    schedule(id, value) {
      // Re-register on use: a saver that holds unsaved work must be reachable by
      // flushAllPending(), even if it was disposed and then used again (React
      // StrictMode remounts the editor in dev). Set.add is idempotent.
      liveSavers.add(saver)
      pending = { id, value }
      clearTimeout(timer)
      timer = setTimeout(startCommit, delayMs)
    },

    async flush() {
      // Looped, not a single pass: schedule() can land while `inFlight` is
      // still being awaited (the caller kept typing during the drain
      // window), which leaves a fresh `pending` behind that a one-shot flush
      // would return from without ever committing.
      while (pending || inFlight) {
        clearTimeout(timer)
        timer = undefined
        startCommit()
        await inFlight
      }
    },

    dispose() {
      clearTimeout(timer)
      timer = undefined
      // Dropped rather than kept: a disposed saver must not hold decrypted
      // note content alive. Callers that want it persisted flush() first.
      pending = null
      liveSavers.delete(saver)
    }
  }

  liveSavers.add(saver)
  return saver
}

/** Drains every live saver. Resolves only once all of them have committed. */
export async function flushAllPending(): Promise<void> {
  await Promise.all([...liveSavers].map((saver) => saver.flush()))
}
