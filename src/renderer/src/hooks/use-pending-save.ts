import { useEffect, useRef } from 'react'

import { createPendingSave, type PendingSave } from '@/lib/pending-save'

type Commit = (id: string, value: string) => Promise<void>

/**
 * Component-scoped debounced saver that drains on unmount instead of dropping
 * what is still pending (issue #19).
 *
 * The saver is created once and outlives re-renders, so it commits through a
 * ref rather than closing over the first `commit` it ever saw. Callers still
 * have to flush it wherever else work can be interrupted — switching notes,
 * closing the editor — since only unmount is handled here.
 */
export function usePendingSave(commit: Commit, delayMs: number): PendingSave {
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  }, [commit])

  const saverRef = useRef<PendingSave | null>(null)
  const saver = (saverRef.current ??= createPendingSave(
    (id, value) => commitRef.current(id, value),
    delayMs
  ))

  useEffect(() => {
    return () => {
      // flush() captures the pending value synchronously, so disposing right
      // after cannot drop anything still unsaved. Caught, not surfaced: the
      // component is already unmounting, there's no UI left to show a toast.
      void saver.flush().catch(() => undefined)
      saver.dispose()
    }
  }, [saver])

  return saver
}
