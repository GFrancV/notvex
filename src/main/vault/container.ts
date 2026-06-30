import { randomBytes, timingSafeEqual } from 'crypto'
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, unlinkSync } from 'fs'
import sodium from 'libsodium-wrappers-sumo'
import os from 'os'
import { join } from 'path'

import { CURRENT_VERSION_MAJ, CURRENT_VERSION_MIN } from '@shared/types'
import { computeHeaderHmac, isValidKdfTier, KdfInputV1 } from './crypto'

const MAGIC_NVX = Buffer.from('NVX\0')

const FieldId = {
  EndOfHeader: 0x00,
  ArgonSalt: 0x01,
  KdfTier: 0x02,
  RecoveryBlob: 0x03,
  HeaderHmac: 0x04
} as const

export interface ContainerMetadata {
  versionMaj: number
  versionMin: number
  kdfInput: KdfInputV1
  recoveryBlob: Buffer
  storedHmac: Buffer
  hmacCoveredBytes: Buffer
  dbOffset: number
}

function tlvField(id: number, data: Buffer): Buffer {
  const field = Buffer.alloc(1 + 4 + data.length)
  field.writeUInt8(id, 0)
  field.writeUInt32LE(data.length, 1)
  data.copy(field, 5)
  return field
}

export function writeContainer(params: {
  masterKey: Buffer
  salt: Buffer
  kdfTier: number
  recoveryBlob: Buffer
  dbBytes: Buffer
  requiredMinVersion?: number
  existingVersionMin?: number
}): Buffer {
  const effectiveMin = Math.max(
    params.requiredMinVersion ?? 0,
    params.existingVersionMin ?? 0,
    CURRENT_VERSION_MIN
  )

  const version = Buffer.alloc(4)
  version.writeUInt16LE(CURRENT_VERSION_MAJ, 0)
  version.writeUInt16LE(effectiveMin, 2)

  const saltField = tlvField(FieldId.ArgonSalt, params.salt)
  const tierField = tlvField(FieldId.KdfTier, Buffer.from([params.kdfTier]))
  const recoveryField = tlvField(FieldId.RecoveryBlob, params.recoveryBlob)

  const headerWithoutHmac = Buffer.concat([MAGIC_NVX, version, saltField, tierField, recoveryField])
  const hmac = computeHeaderHmac(headerWithoutHmac, params.masterKey)
  const hmacField = tlvField(FieldId.HeaderHmac, Buffer.from(hmac))
  sodium.memzero(hmac)

  return Buffer.concat([
    headerWithoutHmac,
    hmacField,
    Buffer.from([FieldId.EndOfHeader]),
    params.dbBytes
  ])
}

function parseHeaderV1(fileBytes: Buffer, versionMin: number): ContainerMetadata {
  const fields: Partial<Record<number, Buffer>> = {}
  let offset = 8
  let hmacFieldStart = -1

  while (offset < fileBytes.length) {
    const fieldId = fileBytes.readUInt8(offset)
    if (fieldId === FieldId.EndOfHeader) {
      offset += 1
      break
    }
    if (offset + 5 > fileBytes.length) throw new Error('HEADER_TRUNCATED')
    const fieldLen = fileBytes.readUInt32LE(offset + 1)
    if (offset + 5 + fieldLen > fileBytes.length) throw new Error('HEADER_TRUNCATED')
    const fieldData = Buffer.from(fileBytes.subarray(offset + 5, offset + 5 + fieldLen))

    if (fieldId === FieldId.HeaderHmac) hmacFieldStart = offset
    fields[fieldId] = fieldData

    offset += 5 + fieldLen
  }

  const saltBuf = fields[FieldId.ArgonSalt]
  const tierBuf = fields[FieldId.KdfTier]
  const recoveryBuf = fields[FieldId.RecoveryBlob]
  const hmacBuf = fields[FieldId.HeaderHmac]

  if (!saltBuf) throw new Error('HEADER_MISSING_SALT')
  if (!tierBuf) throw new Error('HEADER_MISSING_KDF_TIER')
  if (!recoveryBuf) throw new Error('HEADER_MISSING_RECOVERY')
  if (!hmacBuf) throw new Error('HEADER_MISSING_HMAC')
  if (hmacFieldStart === -1) throw new Error('HEADER_MISSING_HMAC')

  const kdfTier = tierBuf.readUInt8(0)
  if (!isValidKdfTier(kdfTier)) throw new Error('HEADER_UNKNOWN_KDF_TIER')

  // Bytes the HMAC covers: everything before the HeaderHmac TLV field
  const hmacCoveredBytes = Buffer.from(fileBytes.subarray(0, hmacFieldStart))

  return {
    versionMaj: 1,
    versionMin,
    kdfInput: { version: 1, salt: saltBuf, kdfTier },
    recoveryBlob: recoveryBuf,
    storedHmac: hmacBuf,
    hmacCoveredBytes,
    dbOffset: offset
  }
}

export function readContainer(fileBytes: Buffer): ContainerMetadata {
  if (fileBytes.length < 8) throw new Error('NOT_NOTVEX_FILE')

  const magic = fileBytes.subarray(0, 4)
  if (!magic.equals(MAGIC_NVX)) throw new Error('NOT_NOTVEX_FILE')

  const versionMaj = fileBytes.readUInt16LE(4)
  const versionMin = fileBytes.readUInt16LE(6)

  if (versionMaj > CURRENT_VERSION_MAJ) throw new Error('VERSION_TOO_NEW')

  switch (versionMaj) {
    case 1:
      return parseHeaderV1(fileBytes, versionMin)
    default:
      throw new Error('UNSUPPORTED_VERSION')
  }
}

// Verifies the header HMAC after the master key is available (post-Argon2id).
// Uses timingSafeEqual to prevent timing side-channel attacks.
export function verifyHeaderHmac(
  hmacCoveredBytes: Buffer,
  storedHmac: Buffer,
  masterKey: Buffer
): boolean {
  const expected = computeHeaderHmac(hmacCoveredBytes, masterKey)
  const valid = timingSafeEqual(expected, storedHmac)
  sodium.memzero(expected)
  return valid
}

export function isValidNotvexFile(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false
    const buf = Buffer.alloc(4)
    const fd = openSync(filePath, 'r')
    readSync(fd, buf, 0, 4, 0)
    closeSync(fd)
    return buf.equals(MAGIC_NVX)
  } catch {
    return false
  }
}

export function makeTempDbPath(): string {
  return join(os.tmpdir(), `notvex_${randomBytes(8).toString('hex')}.db`)
}

export function cleanupOrphanedTempDbs(): void {
  const tmpDir = os.tmpdir()
  const ONE_HOUR_MS = 60 * 60 * 1000
  const now = Date.now()
  // Pattern matches exactly what makeTempDbPath() produces: notvex_<16 hex>.db
  const notvexTempPattern = /^notvex_[a-f0-9]{16}\.db(-wal|-shm)?$/
  try {
    const files = readdirSync(tmpDir)
    for (const file of files) {
      if (!notvexTempPattern.test(file)) continue
      try {
        const { mtimeMs } = statSync(join(tmpDir, file))
        if (now - mtimeMs > ONE_HOUR_MS) {
          unlinkSync(join(tmpDir, file))
        }
      } catch {
        /* in use, already deleted, or no permissions — skip */
      }
    }
  } catch {
    /* tmpdir not accessible — skip */
  }
}
