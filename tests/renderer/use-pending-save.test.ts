// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { usePendingSave } from '@/hooks/use-pending-save'
import { flushAllPending } from '@/lib/pending-save'

const DELAY = 500

function recorder(): {
  commit: (id: string, value: string) => Promise<void>
  calls: Array<[string, string]>
} {
  const calls: Array<[string, string]> = []
  return {
    calls,
    commit: (id, value) => {
      calls.push([id, value])
      return Promise.resolve()
    }
  }
}

describe('usePendingSave', () => {
  afterEach(async () => {
    // Never let one test's live saver leak into the next assertion.
    await flushAllPending()
  })

  it('1 · persists pending work when the component unmounts', async () => {
    const { commit, calls } = recorder()
    const { result, unmount } = renderHook(() => usePendingSave(commit, DELAY))

    act(() => {
      result.current.schedule('note-a', 'typed but not yet saved')
    })
    expect(calls).toEqual([])

    unmount()

    // flush() captures the pending value synchronously, so the commit is
    // already in flight by the time unmount() returns.
    expect(calls).toEqual([['note-a', 'typed but not yet saved']])
  })

  it('2 · stays reachable by flushAllPending() after a StrictMode remount', async () => {
    // StrictMode mounts, unmounts and remounts in dev. The unmount cleanup
    // disposes the saver, and the remounted component keeps the same
    // instance — which must not become invisible to the lock handshake.
    const { commit, calls } = recorder()
    // reactStrictMode is what actually re-runs the effects — wrapping the tree
    // in <StrictMode> by hand does not, as a probe confirmed.
    const { result } = renderHook(() => usePendingSave(commit, DELAY), {
      reactStrictMode: true
    })

    act(() => {
      result.current.schedule('note-a', 'typed after the remount')
    })

    await flushAllPending()

    expect(calls).toEqual([['note-a', 'typed after the remount']])
  })

  it('3 · commits through the latest callback, not the first one it saw', async () => {
    const first = recorder()
    const second = recorder()

    const { result, rerender } = renderHook(
      ({ commit }: { commit: (id: string, value: string) => Promise<void> }) =>
        usePendingSave(commit, DELAY),
      { initialProps: { commit: first.commit } }
    )

    rerender({ commit: second.commit })

    act(() => {
      result.current.schedule('note-a', 'hello')
    })
    await result.current.flush()

    expect(first.calls).toEqual([])
    expect(second.calls).toEqual([['note-a', 'hello']])
  })

  it('4 · keeps the same saver across re-renders', () => {
    const { commit } = recorder()
    const { result, rerender } = renderHook(() => usePendingSave(commit, DELAY))

    const initial = result.current
    rerender()

    expect(result.current).toBe(initial)
  })
})
