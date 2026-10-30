import { describe, expect, it } from 'vitest'

import { vaultName } from '@/lib/utils'

describe('vaultName', () => {
  it('is the file name, whatever the separator', () => {
    expect(vaultName('C:\\Users\\me\\vaults\\work.nvx')).toBe('work.nvx')
    expect(vaultName('/home/me/vaults/home.nvx')).toBe('home.nvx')
    expect(vaultName('\\\\server\\share\\team.nvx')).toBe('team.nvx')
  })

  it('keeps a bare name as it is', () => {
    expect(vaultName('notes.nvx')).toBe('notes.nvx')
  })
})
