import { app } from 'electron'

import { appendError, toErrorLike } from './error-log'
import { closeVault } from './vault/vault'

// closeVault() runs under withVaultLock; if the crash happened while the lock was held it never
// settles. Exiting releases the sodium.malloc'd key anyway, so the wait is bounded.
const CLOSE_TIMEOUT_MS = 3_000

let crashing = false

// Registering these listeners disables Node's default exit, so exiting is explicit: carrying on
// in an undefined state with the master key in memory is the one thing this must not do.
async function lockAndExit(e: unknown): Promise<void> {
  if (crashing) {
    app.exit(1)
    return
  }
  crashing = true
  appendError('main', toErrorLike(e))
  try {
    await Promise.race([
      closeVault(),
      new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS))
    ])
  } catch {
    /* exiting regardless */
  } finally {
    app.exit(1)
  }
}

export function installCrashHandlers(): void {
  process.on('uncaughtException', (e) => void lockAndExit(e))
  process.on('unhandledRejection', (e) => void lockAndExit(e))
  app.on('child-process-gone', (_event, details) => {
    appendError(details.type.toLowerCase().replace(/ /g, '-'), {
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
}
