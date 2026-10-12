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

// The log is plaintext and outlives the vault, so it is built from an allowlist: anything not
// matched below is dropped or replaced, never escaped. Messages are never kept because they
// embed input (V8's JSON.parse errors quote the parsed text, fs errors carry the vault path).

export interface ErrorLike {
  name: string
  stack: string
}

export interface CrashDetails {
  reason: string
  exitCode?: number
}

const FILE_NAME = 'notvex.log'
const ROTATE_AT_BYTES = 512 * 1024
const MAX_FRAMES = 50

const SAFE_NAME = /^[A-Za-z_$][\w$.]{0,63}$/
const SAFE_ORIGIN = /^[a-z][a-z-]{0,31}$/
// Electron's RenderProcessGoneDetails / Details reasons are all lowercase kebab-case.
const SAFE_REASON = /^[a-z][a-z-]{0,31}$/
const SAFE_FUNCTION = /^[\w$.<>[\] ]{1,100}$/
const FRAME = /^\s*at (?:(.+?) \((.+)\)|(.+))$/
const POSITION = /(?::\d+){1,2}$/
const RUNTIME_LOCATION = /^(?:node:|native$|<anonymous>$|index \d+$)/

export function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

const logFile = (): string => join(logDir(), FILE_NAME)

// An Error's getters can throw (a Proxy, a hostile subclass), and a non-Error value can be
// anything, so nothing is read from it beyond name and stack, and never stringified.
export function toErrorLike(e: unknown): ErrorLike {
  try {
    if (e instanceof Error) {
      return { name: String(e.name), stack: typeof e.stack === 'string' ? e.stack : '' }
    }
  } catch {
    /* fall through */
  }
  return { name: 'NonError', stack: '' }
}

function relativeToApp(file: string): string | null {
  let path = file
  if (/^https?:/i.test(path)) {
    const { pathname } = new URL(path)
    // The dev server serves files outside the project as /@fs/<absolute path>.
    if (!pathname.startsWith('/@fs/')) return pathname
    path = `file://${pathname.slice('/@fs'.length)}`
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
  return under ? path.slice(root.length + 1) : null
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
    `[${SAFE_ORIGIN.test(origin) ? origin : 'unknown'}]`,
    `v${app.getVersion()}`
  ]
  if ('reason' in event) {
    header.push(`reason=${SAFE_REASON.test(event.reason) ? event.reason : 'unknown'}`)
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
    mkdirSync(logDir(), { recursive: true, mode: 0o700 })
    const file = logFile()
    if (existsSync(file) && statSync(file).size > ROTATE_AT_BYTES) renameSync(file, `${file}.1`)
    appendFileSync(file, `${formatEntry(origin, event)}\n`, { mode: 0o600 })
  } catch {
    /* swallowed by design */
  }
}

export function readLogTail(lines: number): string {
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
