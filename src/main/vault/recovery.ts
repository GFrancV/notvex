import * as bip39 from 'bip39'

export function generateMnemonic(): string {
  return bip39.generateMnemonic(256)
}

export function mnemonicToMasterKey(mnemonic: string): Uint8Array {
  const seed = bip39.mnemonicToSeedSync(mnemonic) // 64-byte PBKDF2-SHA512 seed
  // Copy the first 32 bytes into an independent buffer, then zero the full seed
  // (including bytes 32-63 which would otherwise remain live in the V8 heap).
  const masterKey = Uint8Array.from(seed.subarray(0, 32))
  seed.fill(0)
  return masterKey // caller is responsible for memzero(masterKey) when done
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic)
}
