import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Electron 43+ opens dialogs without a defaultPath in Downloads and the OS
// stops remembering the last folder, so the main process remembers it.

describe('dialog default path', () => {
  let dialogDir: typeof import('../src/main/dialog-dir')

  beforeEach(async () => {
    vi.resetModules()
    dialogDir = await import('../src/main/dialog-dir')
  })

  it('falls back to the bare file name before any dialog was used', () => {
    expect(dialogDir.dialogDefaultPath('vault.nvx')).toBe('vault.nvx')
    expect(dialogDir.dialogDefaultPath()).toBeUndefined()
  })

  it('suggests the folder of the last picked file', () => {
    const dir = join('home', 'me', 'vaults')
    dialogDir.rememberDialogDir(join(dir, 'work.nvx'))

    expect(dialogDir.dialogDefaultPath('vault.nvx')).toBe(join(dir, 'vault.nvx'))
    expect(dialogDir.dialogDefaultPath()).toBe(dir)
  })

  it('a cancelled dialog does not forget the last folder', () => {
    const dir = join('home', 'me', 'vaults')
    dialogDir.rememberDialogDir(join(dir, 'work.nvx'))
    dialogDir.rememberDialogDir('')
    dialogDir.rememberDialogDir(undefined)

    expect(dialogDir.dialogDefaultPath()).toBe(dir)
  })
})
