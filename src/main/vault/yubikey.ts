import HID from 'node-hid'
import { deriveKey, generateSalt } from './crypto'

const YUBICO_VENDOR_ID = 0x1050
const YUBIKEY_PRODUCT_IDS = [0x0010, 0x0110, 0x0114, 0x0116, 0x0401, 0x0403, 0x0405, 0x0407, 0x0410]

const SLOT2_HMAC_CHALLENGE = 0x38

export interface YubiKeyDevice {
  vendorId: number
  productId: number
  path?: string
  manufacturer?: string
  product?: string
}

export function listYubiKeys(): YubiKeyDevice[] {
  const devices = HID.devices()
  return devices.filter(
    (d) => d.vendorId === YUBICO_VENDOR_ID && YUBIKEY_PRODUCT_IDS.includes(d.productId),
  )
}

export async function hmacSha1ChallengeResponse(challenge: Buffer): Promise<Buffer> {
  const yubikeys = listYubiKeys()
  if (yubikeys.length === 0) {
    throw new Error('No YubiKey found. Insert your YubiKey and try again.')
  }

  const deviceInfo = yubikeys[0]
  if (!deviceInfo.path) {
    throw new Error('YubiKey path not available.')
  }

  const device = new HID.HID(deviceInfo.path)

  try {
    // Build 64-byte HID report: [report_id=0, slot2_cmd, ...challenge padded to 62 bytes]
    const report = Buffer.alloc(64, 0)
    report[0] = 0 // report ID
    report[1] = SLOT2_HMAC_CHALLENGE
    challenge.copy(report, 2, 0, Math.min(challenge.length, 62))

    device.write(Array.from(report))

    // Poll for response (YubiKey may need touch — up to 15s)
    return await new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        device.close()
        reject(new Error('YubiKey response timed out. Did you touch it?'))
      }, 15000)

      const poll = (): void => {
        try {
          const data = device.read()
          if (data && data.length >= 20) {
            clearTimeout(timeout)
            device.close()
            resolve(Buffer.from(data.slice(0, 20)))
          } else {
            setTimeout(poll, 100)
          }
        } catch (err) {
          clearTimeout(timeout)
          device.close()
          reject(err)
        }
      }

      setTimeout(poll, 100)
    })
  } catch (err) {
    device.close()
    throw err
  }
}

export async function deriveKeyFromYubiKey(salt: Uint8Array): Promise<Uint8Array> {
  const challenge = generateSalt() // Use a fresh random challenge
  const response = await hmacSha1ChallengeResponse(Buffer.from(challenge))
  // Stretch 20-byte HMAC response to 32-byte key using Argon2id
  return deriveKey(response.toString('hex'), salt)
}
