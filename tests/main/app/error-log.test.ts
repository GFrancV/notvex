import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The log is plaintext on disk, so these tests prove what can't reach it, not what can.

const SENTINEL = 'SENTINEL-7f3a'
const APP_ROOT = 'C:\\Program Files\\Notvex\\resources\\app.asar'

const state = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userData,
    getAppPath: () => 'C:\\Program Files\\Notvex\\resources\\app.asar',
    getVersion: () => '1.4.0'
  }
}))

const { appendError, clearLog, formatEntry, logDir, readLogTail, toErrorLike } =
  await import('@main/error-log')

const logFile = (): string => join(logDir(), 'notvex.log')

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'notvex-log-'))
  state.userData = root
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('formatEntry', () => {
  it('drops the message, the cause and any non-frame line', () => {
    const err = new TypeError(`bad input ${SENTINEL}`, { cause: SENTINEL })
    err.stack = [
      `TypeError: bad input ${SENTINEL}`,
      `    continued message ${SENTINEL}`,
      `    at parse (${APP_ROOT}\\out\\main\\index.js:1:20)`
    ].join('\n')

    const out = formatEntry('main', toErrorLike(err))

    expect(out).not.toContain(SENTINEL)
    expect(out).toContain('[main] v1.4.0 TypeError')
    expect(out).toContain('    at parse (out/main/index.js:1:20)')
  })

  it('makes app paths relative, whether written as a path or a file URL', () => {
    const stack = [
      'Error: x',
      `    at a (${APP_ROOT}\\out\\main\\index.js:3:4)`,
      '    at b (file:///C:/Program%20Files/Notvex/resources/app.asar/out/renderer/index.js:5:6)',
      `    at ${APP_ROOT}\\out\\main\\chunk.js:7:8`
    ].join('\n')

    const out = formatEntry('main', { name: 'Error', stack })

    expect(out).toContain('    at a (out/main/index.js:3:4)')
    expect(out).toContain('    at b (out/renderer/index.js:5:6)')
    expect(out).toContain('    at out/main/chunk.js:7:8')
    expect(out).not.toContain('Program Files')
  })

  it('replaces paths outside the app with <path>', () => {
    const stack = [
      'Error: x',
      `    at open (C:\\Users\\${SENTINEL}\\Documents\\notes.nvx:1:1)`,
      `    at file:///home/${SENTINEL}/vault.nvx:2:2`,
      `    at /home/${SENTINEL}/vault.nvx:3:3`
    ].join('\n')

    const out = formatEntry('main', { name: 'Error', stack })

    expect(out).not.toContain(SENTINEL)
    expect(out.match(/<path>/g)).toHaveLength(3)
  })

  it('keeps runtime-internal locations as they are', () => {
    const stack = [
      'Error: x',
      '    at node:internal/fs/utils:1:1',
      '    at async Promise.all (index 0)',
      '    at new Promise (<anonymous>)'
    ].join('\n')

    const out = formatEntry('main', { name: 'Error', stack })

    expect(out).toContain('    at node:internal/fs/utils:1:1')
    expect(out).toContain('    at async Promise.all (index 0)')
    expect(out).toContain('    at new Promise (<anonymous>)')
  })

  it.each([
    ['contains the sentinel', `Error ${SENTINEL}`],
    ['is too long', 'E'.repeat(65)],
    ['has spaces', 'Not An Identifier'],
    ['is empty', '']
  ])('writes the name as Error when it %s', (_label, name) => {
    const out = formatEntry('main', { name, stack: '' })
    expect(out).toMatch(/v1\.4\.0 Error$/)
  })

  it('replaces a function name that is not code-shaped', () => {
    const stack = `Error: x\n    at ${SENTINEL}; DROP (out/main/index.js:1:1)`
    expect(formatEntry('main', { name: 'Error', stack })).not.toContain(SENTINEL)
  })

  it('keeps at most 50 frames', () => {
    const frames = Array.from({ length: 80 }, (_, i) => `    at f${i} (node:x:${i}:1)`)
    const out = formatEntry('main', { name: 'Error', stack: ['Error: x', ...frames].join('\n') })
    expect(out.split('\n')).toHaveLength(51)
  })

  it('logs a non-Error as NonError without stringifying it', () => {
    const value = { toString: (): string => SENTINEL, message: SENTINEL }
    const out = formatEntry('main', toErrorLike(value))
    expect(out).toMatch(/v1\.4\.0 NonError$/)
    expect(out).not.toContain(SENTINEL)
  })

  it('writes a crash as its reason and exit code', () => {
    const out = formatEntry('render-process-gone', { reason: 'crashed', exitCode: -1 })
    expect(out).toMatch(/\[render-process-gone\] v1\.4\.0 reason=crashed exitCode=-1$/)
  })

  it('refuses an unexpected reason or origin', () => {
    const out = formatEntry(`origin ${SENTINEL}`, { reason: SENTINEL, exitCode: Number.NaN })
    expect(out).not.toContain(SENTINEL)
    expect(out).toMatch(/\[unknown\] v1\.4\.0 reason=unknown$/)
  })
})

describe('appendError / readLogTail / clearLog', () => {
  it('appends entries and reads back the newest lines', () => {
    appendError('main', { name: 'First', stack: '' })
    appendError('main', { name: 'Second', stack: 'Error\n    at f (node:x:1:1)' })

    const lines = readLogTail(2).split('\n')
    expect(lines[0]).toMatch(/Second$/)
    expect(lines[1]).toBe('    at f (node:x:1:1)')
  })

  it('returns an empty string when there is no log', () => {
    expect(readLogTail(30)).toBe('')
  })

  it.skipIf(process.platform === 'win32')('creates the file readable by its owner only', () => {
    appendError('main', { name: 'Error', stack: '' })
    expect(statSync(logFile()).mode & 0o777).toBe(0o600)
    expect(statSync(logDir()).mode & 0o777).toBe(0o700)
  })

  it('rotates to notvex.log.1 once the file passes 512 KB', () => {
    appendError('main', { name: 'Old', stack: '' })
    writeFileSync(logFile(), 'x'.repeat(512 * 1024 + 1), { flag: 'a' })

    appendError('main', { name: 'New', stack: '' })

    expect(statSync(`${logFile()}.1`).size).toBeGreaterThan(512 * 1024)
    expect(readFileSync(logFile(), 'utf8')).toMatch(/New\n$/)
    expect(readLogTail(1)).toMatch(/New$/)
  })

  it('clears both files', () => {
    appendError('main', { name: 'Error', stack: '' })
    writeFileSync(`${logFile()}.1`, 'old\n')

    clearLog()

    expect(existsSync(logFile())).toBe(false)
    expect(existsSync(`${logFile()}.1`)).toBe(false)
  })

  it('never throws when the log directory cannot be created', () => {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, '')
    state.userData = blocker

    expect(() => appendError('main', { name: 'Error', stack: '' })).not.toThrow()
  })

  it('never throws when the error itself throws on access', () => {
    const hostile = new Proxy(new Error(), {
      get: (): never => {
        throw new Error('boom')
      }
    })
    expect(() => appendError('main', toErrorLike(hostile))).not.toThrow()
  })
})
