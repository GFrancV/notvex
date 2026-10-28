import { notvex } from './ipc'

const MAC_MODIFIERS: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥' }
const NAMES: Record<string, string> = { Mod: 'Ctrl', Escape: 'Esc' }

/**
 * CodeMirror key notation ("Mod-Shift-e") to one label per key, as the user's platform writes
 * them: ["Ctrl", "Shift", "E"], or ["⌘", "⇧", "E"] on macOS.
 */
export function formatShortcut(keys: string): string[] {
  const mac = notvex.platform === 'darwin'
  return keys
    .split('-')
    .map(
      (key) =>
        (mac && MAC_MODIFIERS[key]) || NAMES[key] || (key.length === 1 ? key.toUpperCase() : key)
    )
}
