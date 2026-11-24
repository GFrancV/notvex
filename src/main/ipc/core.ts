import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import { readSync } from 'fs'

import { isTrustedFrame } from '../security/url-guard'
import { isVaultOpen } from '../vault/vault'

export type IpcResult<T> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

export function fail(error: unknown): IpcResult<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

// Every handler registers through this so a call from any frame other than the
// app's own page is refused before it runs. ipcMain.handle has no
// middleware, and a guard line per handler is easy to forget on a new channel.
export function handle(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: never[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) =>
    isTrustedFrame(event) ? fn(event, ...(args as never[])) : fail('Untrusted sender')
  )
}

export function requireVault(): void {
  if (!isVaultOpen()) throw new Error('Vault is locked')
}

// A short read is not EOF; stopping early would silently drop bytes.
export function readFully(fd: number, buf: Uint8Array): number {
  let length = 0
  while (length < buf.length) {
    const n = readSync(fd, buf, length, buf.length - length, length)
    if (n === 0) break
    length += n
  }
  return length
}
