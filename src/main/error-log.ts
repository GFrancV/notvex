import { app } from 'electron'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'fs'
import { join } from 'node:path'

import type { ErrorLike } from '@shared/error-stack'
import { devRendererUrl } from './url-guard'

// The log is plaintext and outlives the vault, so it is built from an allowlist: anything not
// matched below is dropped or replaced, never escaped. Messages are never kept because they
// embed input (V8's JSON.parse errors quote the parsed text, fs errors carry the vault path).

export { toErrorLike, type ErrorLike } from '@shared/error-stack'

export interface CrashDetails {
  reason: string
  exitCode?: number
}

const FILE_NAME = 'notvex.log'
const ROTATE_AT_BYTES = 512 * 1024
const MAX_FRAMES = 50

const SAFE_NAME = /^[A-Za-z_$][\w$.]{0,63}$/
// Origins and Electron's RenderProcessGoneDetails / Details reasons are all lowercase kebab-case.
const SAFE_TOKEN = /^[a-z][a-z-]{0,31}$/
// The stack's header is cut before this runs (toErrorLike), so these are a second line: a frame
// that still carries free text must not pass as a function name or a runtime location.
const SAFE_FUNCTION = /^(?:(?:new|async) )?[\w$.<>]{1,100}(?: \[as [\w$]{1,100}\])?$/
const FRAME = /^\s*at (?:(.+?) \((.+)\)|(.+))$/
const POSITION = /(?::\d+){1,2}$/
const RUNTIME_LOCATION = /^(?:node:[\w/.-]+|native|<anonymous>|index \d+)$/
const PARENT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/

export function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

export function ensureLogDir(): string {
  const dir = logDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

const logFile = (): string => join(logDir(), FILE_NAME)

function relativeToApp(file: string): string | null {
  let path = file
  if (/^https?:/i.test(path)) {
    // Only the dev server's own pages are app code; a packaged build has no dev server at all.
    const devUrl = devRendererUrl()
    const url = new URL(path)
    if (!devUrl || url.origin !== new URL(devUrl).origin) return null
    // The dev server serves files outside the project as /@fs/<absolute path>.
    if (!url.pathname.startsWith('/@fs/')) return url.pathname
    path = `file://${url.pathname.slice('/@fs'.length)}`
  }
  // Parsed by hand, not fileURLToPath: that one only understands the host OS's URL shape.
  if (/^file:/i.test(path)) {
    path = decodeURIComponent(new URL(path).pathname).replace(/^\/([A-Za-z]:\/)/, '$1')
  }
  const root = app.getAppPath().replace(/\\/g, '/').replace(/\/$/, '')
  path = path.replace(/\\/g, '/')
  // Windows paths are case-insensitive.
  const under = /^[A-Za-z]:\//.test(root)
    ? path.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    : path.startsWith(`${root}/`)
  const relative = under ? path.slice(root.length + 1) : null
  // root/../../x passes the prefix check but points outside the app.
  return relative !== null && !PARENT_SEGMENT.test(relative) ? relative : null
}

function trimLocation(location: string): string {
  const position = POSITION.exec(location)?.[0] ?? ''
  const file = location.slice(0, location.length - position.length)
  if (RUNTIME_LOCATION.test(file)) return location
  try {
    const relative = relativeToApp(file)
    return relative === null ? '<path>' : relative + position
  } catch {
    return '<path>'
  }
}

function trimFrame(line: string): string | null {
  const m = FRAME.exec(line)
  if (!m) return null
  const [, fn, wrapped, bare] = m
  const location = trimLocation(wrapped ?? bare)
  if (fn === undefined) return `    at ${location}`
  return `    at ${SAFE_FUNCTION.test(fn) ? fn : '<fn>'} (${location})`
}

export function formatEntry(origin: string, event: ErrorLike | CrashDetails): string {
  const header = [
    new Date().toISOString(),
    `[${SAFE_TOKEN.test(origin) ? origin : 'unknown'}]`,
    `v${app.getVersion()}`
  ]
  if ('reason' in event) {
    header.push(`reason=${SAFE_TOKEN.test(event.reason) ? event.reason : 'unknown'}`)
    if (Number.isInteger(event.exitCode)) header.push(`exitCode=${event.exitCode}`)
    return header.join(' ')
  }
  header.push(SAFE_NAME.test(event.name) ? event.name : 'Error')
  const frames = event.stack
    .split('\n')
    .map(trimFrame)
    .filter((f): f is string => f !== null)
    .slice(0, MAX_FRAMES)
  return [header.join(' '), ...frames].join('\n')
}

// Runs inside uncaughtException, so it is synchronous and can't throw: a failing logger must
// not replace the crash it was recording, or recurse into itself.
export function appendError(origin: string, event: ErrorLike | CrashDetails): void {
  try {
    ensureLogDir()
    const file = logFile()
    if (existsSync(file) && statSync(file).size > ROTATE_AT_BYTES) renameSync(file, `${file}.1`)
    appendFileSync(file, `${formatEntry(origin, event)}\n`, { mode: 0o600 })
  } catch {
    /* swallowed by design */
  }
}

export function readLogTail(lines: number): string {
  // slice(-0) would return the whole log.
  if (lines <= 0) return ''
  const file = logFile()
  const text = [`${file}.1`, file]
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('')
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .slice(-lines)
    .join('\n')
}

export function clearLog(): void {
  const file = logFile()
  rmSync(file, { force: true })
  rmSync(`${file}.1`, { force: true })
}
