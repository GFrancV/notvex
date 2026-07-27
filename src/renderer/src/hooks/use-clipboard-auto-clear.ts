import { useEffect } from 'react'

import { notvex } from '@/lib/ipc'

export function useClipboardAutoClear(target: HTMLElement | null): void {
  useEffect(() => {
    if (!target) return

    const handleCopy = (): void => {
      const selected = window.getSelection()?.toString()
      if (!selected) return
      void notvex.clipboard.scheduleClear(selected)
    }

    target.addEventListener('copy', handleCopy)
    return () => target.removeEventListener('copy', handleCopy)
  }, [target])
}
