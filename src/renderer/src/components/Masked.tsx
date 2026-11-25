import type { ReactNode } from 'react'

import { usePrivacyMode } from '@/hooks/use-privacy-mode'

// Same length for every value: a title's length is a hint too.
const PRIVACY_MASK = '••••••••'

/**
 * A note title or tag name as it may be shown on screen. In privacy mode the real text is not
 * rendered at all, so selecting, copying or a screen reader can't recover it.
 */
export function Masked({ text }: { text: string }): ReactNode {
  const { privacyMode } = usePrivacyMode()
  if (!privacyMode) return text
  return (
    <>
      <span aria-hidden="true">{PRIVACY_MASK}</span>
      <span className="sr-only">Hidden</span>
    </>
  )
}
