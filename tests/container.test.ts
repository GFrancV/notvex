import { describe, expect, it } from 'vitest'

import { initSodium } from '../src/main/vault/crypto'
import { readContainer, verifyHeaderHmac, writeContainer } from '../src/main/vault/container'

async function baseParams(devBuild?: boolean): Promise<Parameters<typeof writeContainer>[0]> {
  await initSodium()
  return {
    masterKey: Buffer.alloc(32, 7),
    salt: Buffer.alloc(16, 1),
    kdfTier: 4,
    recoveryBlob: Buffer.alloc(8, 2),
    dbBytes: Buffer.from('fake-sqlcipher-body'),
    devBuild
  }
}

describe('container devBuild field (issue #34)', () => {
  it('round-trips devBuild: true', async () => {
    const bytes = writeContainer(await baseParams(true))
    const metadata = readContainer(bytes)
    expect(metadata.devBuild).toBe(true)
  })

  it('round-trips devBuild: false as an omitted field', async () => {
    const bytes = writeContainer(await baseParams(false))
    const metadata = readContainer(bytes)
    expect(metadata.devBuild).toBe(false)
  })

  it('parses a pre-existing header with no devBuild field as devBuild: false', async () => {
    // Simulates a vault written before this field existed.
    const params = await baseParams(undefined)
    const bytes = writeContainer(params)
    const metadata = readContainer(bytes)
    expect(metadata.devBuild).toBe(false)
  })

  it('fails HMAC verification if only the devBuild byte is tampered with', async () => {
    const params = await baseParams(true)
    const bytes = writeContainer(params)

    // Flip the devBuild field's data byte in place without touching anything else.
    const devBuildByteOffset = bytes.indexOf(Buffer.from([0x05, 0x01, 0x00, 0x00, 0x00, 0x01]))
    expect(devBuildByteOffset).toBeGreaterThan(-1)
    const tampered = Buffer.from(bytes)
    tampered[devBuildByteOffset + 5] = 0x00
    const tamperedMetadata = readContainer(tampered)

    expect(
      verifyHeaderHmac(
        tamperedMetadata.hmacCoveredBytes,
        tamperedMetadata.storedHmac,
        params.masterKey
      )
    ).toBe(false)
  })
})
