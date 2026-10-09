import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// Fuses are flipped in the binary at package time, so the config is the only thing a unit
// test can hold in place. Read as text: the block is flat and no YAML parser is a direct dep.
function electronFusesBlock(): string {
  const yml = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8')
  return yml.match(/^electronFuses:\r?\n((?:[ \t]+.*\r?\n?)*)/m)?.[1] ?? ''
}

describe('electron-builder fuses', () => {
  it.each([
    ['runAsNode', false],
    ['enableNodeOptionsEnvironmentVariable', false],
    ['enableNodeCliInspectArguments', false],
    ['enableEmbeddedAsarIntegrityValidation', true],
    ['onlyLoadAppFromAsar', true],
    ['resetAdHocDarwinSignature', true]
  ])('sets %s to %s', (fuse, value) => {
    expect(electronFusesBlock()).toMatch(new RegExp(`^\\s+${fuse}: ${value}\\s*$`, 'm'))
  })
})
