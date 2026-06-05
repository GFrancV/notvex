import { randomBytes } from 'crypto'
import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  readSync,
  closeSync,
  existsSync,
} from 'fs'
import os from 'os'
import { join } from 'path'

const MAGIC = Buffer.from('NVEX')
const FORMAT_VERSION = 1

export function readContainer(filePath: string): { sidecarJson: string; dbBytes: Buffer } {
  const data = readFileSync(filePath)

  if (data.length < 10 || !data.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Not a valid Notvex vault file.')
  }

  const version = data.readUInt16LE(4)
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported vault format version: ${version}`)
  }

  const sidecarLen = data.readUInt32LE(6)
  if (data.length < 10 + sidecarLen) {
    throw new Error('Vault file is corrupted (truncated sidecar).')
  }

  const sidecarJson = data.subarray(10, 10 + sidecarLen).toString('utf8')
  const dbBytes = data.subarray(10 + sidecarLen)

  return { sidecarJson, dbBytes }
}

export function writeContainer(filePath: string, sidecarJson: string, dbBytes: Buffer): void {
  const sidecarBuf = Buffer.from(sidecarJson, 'utf8')
  const header = Buffer.alloc(10)
  MAGIC.copy(header, 0)
  header.writeUInt16LE(FORMAT_VERSION, 4)
  header.writeUInt32LE(sidecarBuf.length, 6)

  const tmpPath = filePath + '.tmp'
  writeFileSync(tmpPath, Buffer.concat([header, sidecarBuf, dbBytes]))
  renameSync(tmpPath, filePath)
}

export function makeTempDbPath(): string {
  return join(os.tmpdir(), `notvex_${randomBytes(8).toString('hex')}.db`)
}

export function isNotvexContainer(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false
    const buf = Buffer.alloc(4)
    const fd = openSync(filePath, 'r')
    readSync(fd, buf, 0, 4, 0)
    closeSync(fd)
    return buf.equals(MAGIC)
  } catch {
    return false
  }
}
