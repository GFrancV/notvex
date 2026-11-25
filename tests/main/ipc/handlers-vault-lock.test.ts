import { readFileSync } from 'fs'

import { describe, expect, it } from 'vitest'

// Structural, not behavioral: there's no electron mocking here to invoke the real handlers, so
// this asserts on the notes/tags IPC modules' source instead.
describe('notes/tags IPC handlers wrapped in withVaultLock', () => {
  // Explicit lists, not derived from the source, so a renamed, removed or moved channel fails
  // loudly instead of quietly shrinking the checked set.
  const CHANNELS_BY_FILE: Record<string, string[]> = {
    'src/main/notes/ipc.ts': [
      'notes:create',
      'notes:get',
      'notes:list',
      'notes:update',
      'notes:trash',
      'notes:restore',
      'notes:delete',
      'notes:duplicate',
      'notes:empty-trash',
      'notes:counts'
    ],
    'src/main/tags/ipc.ts': [
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
  }

  it.each(Object.entries(CHANNELS_BY_FILE))(
    'each handler in %s wraps its body in withVaultLock(...)',
    (file, channels) => {
      const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf-8')
      // Handlers register through the handle() wrapper, one call per line at the register
      // function's indentation.
      const handleCallStarts = [...source.matchAll(/^ {2}handle\(/gm)].map((m) => m.index)
      expect(handleCallStarts.length).toBeGreaterThanOrEqual(channels.length)

      for (const channel of channels) {
        const channelIdx = source.indexOf(`'${channel}'`)
        expect(channelIdx, `channel '${channel}' not found in ${file}`).toBeGreaterThan(-1)

        // A channel's block runs from its own handle( call to the next one (or EOF).
        const blockStart = handleCallStarts.filter((i) => i <= channelIdx).pop()
        const blockEnd = handleCallStarts.find((i) => i > channelIdx) ?? source.length
        const block = source.slice(blockStart, blockEnd)

        const lockIdx = block.indexOf('withVaultLock(')
        expect(lockIdx, `'${channel}' handler must call withVaultLock(...)`).toBeGreaterThan(-1)

        // Every getDb()/getMasterKey() must come after withVaultLock(, i.e. inside its closure,
        // not merely somewhere in the block.
        for (const match of block.matchAll(/\b(?:getDb|getMasterKey)\(/g)) {
          expect(
            match.index,
            `'${channel}' handler must read getDb()/getMasterKey() inside withVaultLock()`
          ).toBeGreaterThan(lockIdx)
        }
      }
    }
  )
})
