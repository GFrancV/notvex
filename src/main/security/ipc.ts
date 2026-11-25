import { shell } from 'electron'

import { fail, handle, ok } from '../ipc/core'
import { isSafeExternalUrl } from './url-guard'

export function registerSecurityHandlers(): void {
  handle('shell:open-external', async (_e, url: string) => {
    try {
      if (!isSafeExternalUrl(url)) return fail('URL must start with http:// or https://')
      await shell.openExternal(url)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })
}
