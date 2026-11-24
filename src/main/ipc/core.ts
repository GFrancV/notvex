import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import { readSync } from 'fs'

import type { IpcResult } from '@shared/types'
import { isTrustedFrame } from '../security/url-guard'
import { isVaultOpen } from '../vault/vault'

export type { IpcResult }

export function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

/**
 * The renderer shows `error` as is, so a thrown message must already be fit for the user.
 *
 * @returns `{ success: false, error }`, with only the message of an `Error` and anything else
 * stringified.
 * @example
 * fail(new Error('Vault is locked')) // { success: false, error: 'Vault is locked' }
 * fail('Invalid version') // { success: false, error: 'Invalid version' }
 */
export function fail(error: unknown): IpcResult<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

/**
 * Every handler registers through this so a call from any frame other than the app's own page
 * is refused before it runs. ipcMain.handle has no middleware, and a guard line per handler is
 * easy to forget on a new channel.
 *
 * @returns nothing; an untrusted caller gets `{ success: false, error: 'Untrusted sender' }` and
 * `fn` never runs.
 * @example
 * handle('prefs:get', () => ok(getPrefs()))
 */
export function handle(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: never[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) =>
    isTrustedFrame(event) ? fn(event, ...(args as never[])) : fail('Untrusted sender')
  )
}

/**
 * Throws instead of returning, so a handler's own `catch` turns it into the reply.
 *
 * @example
 * handle('tags:list', async () => {
 *   try {
 *     requireVault()
 *     return ok(await withVaultLock(() => listTags(getDb())))
 *   } catch (e) {
 *     return fail(e) // locked: { success: false, error: 'Vault is locked' }
 *   }
 * })
 */
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
