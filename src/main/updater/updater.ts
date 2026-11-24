import { app, BrowserWindow, net } from 'electron'
import { autoUpdater } from 'electron-updater'

import type { UpdateInfo } from '@shared/types'

import { logError } from '../log/log'
import { getPref, setPref } from '../prefs'
import { parseInAppBlock, type InAppNotes } from './release-notes'

const RELEASE_API_URL = 'https://api.github.com/repos/GFrancV/notvex/releases/tags/v'
const RELEASE_PAGE_URL = 'https://github.com/GFrancV/notvex/releases/tag/v'
const RELEASE_API_TIMEOUT_MS = 5000
// Short enough that a patch still shows up inside its 7-day release window
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000
// prefs.json can be hand-edited to skip a version for up to one minor release cycle; a longer
// expiry (a wrong clock when snoozing, a huge value) is ignored so no version stays hidden for good
const MAX_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

export function snoozeUpdate(version: string): void {
  setPref('updateSnooze', { version, until: Date.now() + SNOOZE_MS })
}

// Closing the dialog hides the version until the app quits, so it lives in memory, not prefs
let dismissedVersion: string | null = null

export function dismissUpdateForSession(version: string): void {
  dismissedVersion = version
}

// A manual check is an explicit request to see the update, so it forgets both
export function clearUpdateSilences(): void {
  dismissedVersion = null
  setPref('updateSnooze', null)
}

function isSilenced(version: string): boolean {
  if (version === dismissedVersion) return true
  const snooze = getPref('updateSnooze')
  if (snooze && snooze.until > Date.now() + MAX_SNOOZE_MS) return false
  return snooze?.version === version && Date.now() < snooze.until
}

// electron-updater emits 'error' before the download promise rejects, so the error listener
// still sees this set and can say which step failed
let downloading = false

export async function downloadUpdate(): Promise<void> {
  downloading = true
  try {
    await autoUpdater.downloadUpdate()
  } finally {
    downloading = false
  }
}

// Any failure falls back to the full notes from latest.yml: the dialog must never wait on
// or break because of GitHub's API.
async function fetchInAppNotes(version: string): Promise<InAppNotes | null> {
  // The timer covers reading the body too: a stalled stream must not hold the dialog back.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RELEASE_API_TIMEOUT_MS)
  try {
    const res = await net.fetch(RELEASE_API_URL + version, { signal: controller.signal })
    if (!res.ok) return null
    const { body } = (await res.json()) as { body?: unknown }
    return typeof body === 'string' ? parseInAppBlock(body) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// latest.yml comes from the release: a malformed field would throw while the dialog formats it,
// and the only error boundary is the app's root
function validDate(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

function validSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

// autoUpdater is app-wide but createWindow() calls this once per window, and
// macOS `activate` creates more than one. Listeners are registered once and
// send to the latest window, skipping it while it's destroyed.
let currentWin: BrowserWindow | null = null
let listenersRegistered = false

function send(channel: string, ...args: unknown[]): void {
  if (currentWin && !currentWin.isDestroyed()) currentWin.webContents.send(channel, ...args)
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  currentWin = mainWindow
  if (listenersRegistered) return
  listenersRegistered = true

  // Its default logger is console and prints full stacks and cache paths; the
  // 'error' listener below logs through logError instead.
  autoUpdater.logger = null
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.on('update-available', async (info) => {
    // Main decides, not the renderer: the renderer is recycled on every lock and would forget
    if (isSilenced(info.version)) return
    const notes = await fetchInAppNotes(info.version)
    const payload: UpdateInfo = {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      summary: notes?.summary ?? null,
      security: notes?.security ?? false,
      releaseDate: validDate(info.releaseDate),
      size: validSize(info.files[0]?.size),
      releaseUrl: RELEASE_PAGE_URL + info.version
    }
    send('updater:update-available', payload)
  })

  autoUpdater.on('update-not-available', () => {
    send('updater:update-not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    send('updater:download-progress', {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', () => {
    send('updater:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    logError('[updater] error:', err)
    send('updater:error', {
      message: downloading ? "Couldn't download the update" : "Couldn't check for updates"
    })
  })
}
