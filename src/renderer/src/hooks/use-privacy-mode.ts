import { toast } from 'sonner'

import { usePrefsStore } from '@/store/prefs.store'

/**
 * Switches privacy mode; reverts and says so if it can't be saved. A plain function, so a caller
 * that only toggles (a keyboard shortcut) doesn't re-render whenever the mode changes.
 */
export async function togglePrivacyMode(): Promise<void> {
  const { privacyMode, setPref } = usePrefsStore.getState()
  const on = !privacyMode
  if (!(await setPref('privacyMode', on))) {
    toast.error(on ? "Couldn't turn on privacy mode" : "Couldn't turn off privacy mode")
  }
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
