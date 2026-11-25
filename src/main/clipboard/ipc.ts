import { fail, handle, ok } from '../ipc/core'
import { isVaultOpen } from '../vault/vault'
import { writeClipboard } from './clipboard-guard'

// Far above any real note; only bounds what an untrusted renderer can push onto the clipboard.
const CLIPBOARD_MAX_CHARS = 10_000_000

export function registerClipboardHandlers(): void {
  handle('clipboard:write', async (_e, text: unknown, opts: unknown) => {
    try {
      if (typeof text !== 'string' || text === '' || text.length > CLIPBOARD_MAX_CHARS) {
        return fail('Invalid clipboard value')
      }
      const flags = opts as { secret?: unknown; fromUnlockedView?: unknown } | null | undefined
      const secret = flags?.secret === true
      // The renderer hears of a lock only after main cleared the clipboard, so a copy from the
      // view it still shows can arrive with the vault closed. The recovery key is shown once, so
      // its copy goes through regardless. Nothing may await between this check and
      // writeClipboard(): a lock in that gap would be missed by both this and its lock generation.
      if (!secret && flags?.fromUnlockedView === true && !isVaultOpen()) {
        return fail('Vault is locked')
      }
      await writeClipboard(text, { secret })
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })
}
