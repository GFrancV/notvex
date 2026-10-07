import { dirname, join } from 'node:path'

// Electron 43+ opens file dialogs without a defaultPath in Downloads and the OS
// no longer remembers the last folder, so remember it here.
// ponytail: per session and shared by every dialog; persist it in prefs if users want it across restarts
let lastDir: string | undefined

export function dialogDefaultPath(fileName = ''): string | undefined {
  if (!lastDir) return fileName || undefined
  return join(lastDir, fileName)
}

export function rememberDialogDir(filePath: string | undefined): void {
  if (filePath) lastDir = dirname(filePath)
}
