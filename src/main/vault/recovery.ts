import * as bip39 from 'bip39'
import { hashForVerify } from './crypto'

export function generateMnemonic(): string {
  return bip39.generateMnemonic(256)
}

export function mnemonicToMasterKey(mnemonic: string): Uint8Array {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  return new Uint8Array(seed.buffer, seed.byteOffset, 32)
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic)
}

export function recoveryVerifyHash(mnemonic: string): string {
  const key = mnemonicToMasterKey(mnemonic)
  return hashForVerify(key)
}
