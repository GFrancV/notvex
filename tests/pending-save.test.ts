import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPendingSave, flushAllPending } from '../src/renderer/src/lib/pending-save'

const DELAY = 500

/** Records every (id, value) pair the saver commits, in order. */
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

describe('pending-save', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('1 · does not commit before the delay elapses', async () => {
    const { commit, calls } = recorder()
    const saver = createPendingSave(commit, DELAY)

    saver.schedule('a', 'hello')
    await vi.advanceTimersByTimeAsync(DELAY - 1)

    expect(calls).toEqual([])
    saver.dispose()
  })

  it('2 · commits once the delay elapses', async () => {
    const { commit, calls } = recorder()
    const saver = createPendingSave(commit, DELAY)

    saver.schedule('a', 'hello')
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([['a', 'hello']])
    saver.dispose()
  })

  it('3 · debounces rapid schedules into a single commit with the last value', async () => {
    const { commit, calls } = recorder()
    const saver = createPendingSave(commit, DELAY)

    saver.schedule('a', 'h')
    await vi.advanceTimersByTimeAsync(100)
    saver.schedule('a', 'he')
    await vi.advanceTimersByTimeAsync(100)
    saver.schedule('a', 'hel')
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(calls).toEqual([['a', 'hel']])
    saver.dispose()
  })

  it('4 · flush() commits immediately and the cancelled timer never re-emits', async () => {
    const { commit, calls } = recorder()
    const saver = createPendingSave(commit, DELAY)

    saver.schedule('a', 'hello')
    await saver.flush()

    expect(calls).toEqual([['a', 'hello']])

    // The pending timer must have been cancelled — letting it run changes nothing.
    await vi.advanceTimersByTimeAsync(DELAY * 2)
    expect(calls).toEqual([['a', 'hello']])

    saver.dispose()
  })

  it('5 · flush() with nothing pending commits nothing', async () => {
    const { commit, calls } = recorder()
    const saver = createPendingSave(commit, DELAY)

    await saver.flush()
    expect(calls).toEqual([])

    // Already-committed work must not be replayed by a second flush either.
    saver.schedule('a', 'hello')
    await saver.flush()
    await saver.flush()
    expect(calls).toEqual([['a', 'hello']])

    saver.dispose()
  })

  it('6 · flush() commits against the id captured at schedule time, never a later one', async () => {
    const { commit, calls } = recorder()
    const saver = createPendingSave(commit, DELAY)

    // Note A is typed into and flushed by a note switch...
    saver.schedule('note-a', 'text for A')
    await saver.flush()
    // ...then note B is typed into and flushed the same way.
    saver.schedule('note-b', 'text for B')
    await saver.flush()

    // A's text must never land in B — that is the data-corruption case.
    expect(calls).toEqual([
      ['note-a', 'text for A'],
      ['note-b', 'text for B']
    ])

    saver.dispose()
  })

  it('7 · flushAllPending() awaits every live instance', async () => {
    const resolvers: Array<() => void> = []
    const settled: string[] = []
    const slowCommit = (id: string): Promise<void> =>
      new Promise<void>((resolve) => {
        resolvers.push(() => {
          settled.push(id)
          resolve()
        })
      })

    const first = createPendingSave(slowCommit, DELAY)
    const second = createPendingSave(slowCommit, DELAY)
    first.schedule('content', 'body text')
    second.schedule('title', 'a title')

    let done = false
    const all = flushAllPending().then(() => {
      done = true
    })

    // Both commits are in flight; neither has settled yet.
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    expect(resolvers).toHaveLength(2)

    resolvers.forEach((r) => r())
    await all

    expect(done).toBe(true)
    expect(settled.sort()).toEqual(['content', 'title'])

    first.dispose()
    second.dispose()
  })

  it('8 · dispose() unregisters the instance from flushAllPending()', async () => {
    const { commit, calls } = recorder()
    const saver = createPendingSave(commit, DELAY)

    saver.schedule('a', 'hello')
    saver.dispose()

    await flushAllPending()
    await vi.advanceTimersByTimeAsync(DELAY * 2)

    expect(calls).toEqual([])
  })

  it('9 · scheduling after dispose() re-registers the instance', async () => {
    // React StrictMode double-mounts in dev: the unmount cleanup disposes the
    // saver, then the component mounts again and keeps using that same
    // instance. A saver holding unsaved work must always be reachable by
    // flushAllPending(), whatever the mount choreography.
    const { commit, calls } = recorder()
    const saver = createPendingSave(commit, DELAY)

    saver.dispose()
    saver.schedule('a', 'typed after remount')

    await flushAllPending()

    expect(calls).toEqual([['a', 'typed after remount']])
    saver.dispose()
  })

  it('10 · flush() waits for a commit the timer already started', async () => {
    // A real commit is a round trip that encrypts and writes to SQLCipher, so
    // there is a window where nothing is *pending* but a write is still in
    // flight. Resolving then would ack the lock handshake early and let the
    // main process close the vault underneath that write.
    let released = false
    let release!: () => void
    const commit = (): Promise<void> =>
      new Promise<void>((resolve) => {
        release = (): void => {
          released = true
          resolve()
        }
      })

    const saver = createPendingSave(commit, DELAY)
    saver.schedule('a', 'typed')

    // The debounce fires: pending is now empty, but the write has not landed.
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(released).toBe(false)

    let flushed = false
    const flushing = saver.flush().then(() => {
      flushed = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(flushed).toBe(false)

    release()
    await flushing
    expect(flushed).toBe(true)

    saver.dispose()
  })
})
