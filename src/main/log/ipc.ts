import { app, shell } from 'electron'
import { release } from 'node:os'

import { fail, handle, ok } from '../ipc/core'
import { appendError, clearLog, ensureLogDir, readLogTail } from './error-log'

const LOG_STACK_MAX = 4 * 1024
const LOG_RATE_LIMIT = 10
const LOG_RATE_WINDOW_MS = 60_000
const REPORT_LOG_LINES = 30

let rendererErrorTimes: number[] = []

export function registerLogHandlers(): void {
  // The renderer is untrusted here: an error loop must not fill the disk, so past the limit
  // errors are dropped, and ok() because the renderer can do nothing useful with a refusal.
  handle('log:error', (_e, payload: unknown) => {
    try {
      const { name, stack } = (
        typeof payload === 'object' && payload !== null ? payload : {}
      ) as Record<string, unknown>
      if (typeof name !== 'string' || typeof stack !== 'string') {
        return fail('Invalid error payload')
      }
      const now = Date.now()
      rendererErrorTimes = rendererErrorTimes.filter((t) => now - t < LOG_RATE_WINDOW_MS)
      if (rendererErrorTimes.length >= LOG_RATE_LIMIT) return ok(null)
      rendererErrorTimes.push(now)
      appendError('renderer', { name, stack: stack.slice(0, LOG_STACK_MAX) })
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // Returned as parts, not one text: the renderer drops log lines to fit the issue URL limit.
  handle('log:build-report', () => {
    try {
      const environment = [
        `**Version:** ${app.getVersion()}`,
        `**Electron:** ${process.versions.electron ?? 'unknown'}`,
        `**OS:** ${process.platform} ${release()} ${process.arch}`
      ].join(' · ')
      return ok({ environment, log: readLogTail(REPORT_LOG_LINES) })
    } catch (e) {
      return fail(e)
    }
  })

  handle('log:open-folder', async () => {
    try {
      const result = await shell.openPath(ensureLogDir())
      return result ? fail(result) : ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('log:clear', () => {
    try {
      clearLog()
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })
}
