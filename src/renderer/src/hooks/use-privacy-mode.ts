import { usePrefsStore } from '@/store/prefs.store'

/**
 * Switches privacy mode. A plain function, so a caller that only toggles (a keyboard shortcut)
 * doesn't re-render whenever the mode changes.
 */
export async function togglePrivacyMode(): Promise<void> {
  const { privacyMode, setPref } = usePrefsStore.getState()
  await setPref('privacyMode', !privacyMode)
}

/**
 * Privacy mode for anything that shows or switches it: read the mode and toggle it here, not
 * through the prefs store.
 *
 * @example
 * const { privacyMode, toggle } = usePrivacyMode()
 */
export function usePrivacyMode(): { privacyMode: boolean; toggle: () => Promise<void> } {
  const privacyMode = usePrefsStore((s) => s.privacyMode)
  return { privacyMode, toggle: togglePrivacyMode }
}
