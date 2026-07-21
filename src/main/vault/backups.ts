import { createHash } from 'crypto'
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'

const MAX_BACKUPS_PER_VAULT = 3

// Backups live under userData, keyed by a hash of the vault's normalized path, so a vault's
// backup history survives the vault file itself being renamed or moved elsewhere on disk.
export function getVaultBackupDir(filePath: string): string {
  const normalized =
    process.platform === 'win32' ? resolve(filePath).toLowerCase() : resolve(filePath)
  const hash = createHash('sha256').update(normalized).digest('hex')
  return join(app.getPath('userData'), 'vault-backups', hash)
}

export function ensureVaultBackupDir(filePath: string): string {
  const dir = getVaultBackupDir(filePath)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function createVaultBackup(
  filePath: string,
  reason: 'header' | 'schema',
  fromVersion: number,
  toVersion: number
): void {
  const dir = ensureVaultBackupDir(filePath)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  copyFileSync(filePath, join(dir, `${reason}-v${fromVersion}-to-v${toVersion}-${ts}.nvx`))

  const files = readdirSync(dir)
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const { f } of files.slice(MAX_BACKUPS_PER_VAULT)) unlinkSync(join(dir, f))
}

export function hasAnyBackups(filePath: string): boolean {
  const dir = getVaultBackupDir(filePath)
  return existsSync(dir) && readdirSync(dir).length > 0
}
