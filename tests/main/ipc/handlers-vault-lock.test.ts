import { readFileSync } from 'fs'

import { describe, expect, it } from 'vitest'

// Structural, not behavioral: there's no electron mocking here to invoke the real handlers, so
// this asserts on ipc-handlers.ts's source instead.
describe('ipc-handlers.ts: notes/tags handlers wrapped in withVaultLock (issue #25)', () => {
  // Explicit list, not derived from the source, so a renamed or removed channel fails loudly
  // instead of quietly shrinking the checked set.
  const NOTE_AND_TAG_CHANNELS = [
    'notes:create',
    'notes:get',
    'notes:list',
    'notes:update',
    'notes:trash',
    'notes:restore',
    'notes:delete',
    'notes:empty-trash',
    'notes:search',
    'tags:create',
    'tags:create-and-assign',
    'tags:list',
    'tags:update',
    'tags:delete',
    'note-tags:add',
    'note-tags:remove',
    'note-tags:list',
    'note-tags:counts',
    'note-tags:all'
  ]

  it('each notes:*/tags:*/note-tags:* handler wraps its body in withVaultLock(...)', () => {
    const source = readFileSync(
      new URL('../../../src/main/ipc-handlers.ts', import.meta.url),
      'utf-8'
    )
    // Handlers register through the local handle() wrapper, one call per
    // line at registerIpcHandlers' indentation.
    const handleCallStarts = [...source.matchAll(/^ {2}handle\(/gm)].map((m) => m.index)
    expect(handleCallStarts.length).toBeGreaterThan(NOTE_AND_TAG_CHANNELS.length)

    for (const channel of NOTE_AND_TAG_CHANNELS) {
      const channelIdx = source.indexOf(`'${channel}'`)
      expect(channelIdx, `channel '${channel}' not found in ipc-handlers.ts`).toBeGreaterThan(-1)

      // A channel's block runs from its own handle( call to the next one (or EOF).
      const blockStart = handleCallStarts.filter((i) => i <= channelIdx).pop()
      const blockEnd = handleCallStarts.find((i) => i > channelIdx) ?? source.length
      const block = source.slice(blockStart, blockEnd)

      const lockIdx = block.indexOf('withVaultLock(')
      expect(
        lockIdx,
        `'${channel}' handler must call withVaultLock(...) — see issue #25`
      ).toBeGreaterThan(-1)

      // Every getDb()/getMasterKey() must come after withVaultLock(, i.e. inside its closure, not
      // merely somewhere in the block.
      for (const match of block.matchAll(/\b(?:getDb|getMasterKey)\(/g)) {
        expect(
          match.index,
          `'${channel}' handler must read getDb()/getMasterKey() inside withVaultLock() — see issue #25`
        ).toBeGreaterThan(lockIdx)
      }
    }
  })
})
