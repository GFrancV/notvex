import { useEffect } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'

function selectedText(target: Element | null): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0)
  }
  return window.getSelection()?.toString() ?? ''
}

// Clipboard history and cloud sync decide whether to keep an item when it is written, so a
// user copy must not reach the clipboard through Chromium: main writes it with the opt-out
// markers instead. Registered on document in the bubble phase so CodeMirror's own handler has
// already put its text (line-wise copies, selections beyond the viewport) in clipboardData.
function guardCopy(event: ClipboardEvent): void {
  const data = event.clipboardData
  const target = document.activeElement
  if (!data || (target instanceof HTMLInputElement && target.type === 'password')) return

  const handled = event.defaultPrevented
  const text = data.getData('text/plain') || selectedText(target)
  if (!text) return

  event.preventDefault()
  data.clearData()
  // Cancelling a native cut also cancels its deletion; execCommand keeps it on the undo stack.
  if (event.type === 'cut' && !handled) document.execCommand('delete')

  const failed = (): void => void toast.error('Failed to copy to clipboard')
  void notvex.clipboard.write(text).then((result) => {
    if (!result.success) failed()
  }, failed)
}

export function useClipboardGuard(): void {
  useEffect(() => {
    document.addEventListener('copy', guardCopy)
    document.addEventListener('cut', guardCopy)
    return () => {
      document.removeEventListener('copy', guardCopy)
      document.removeEventListener('cut', guardCopy)
    }
  }, [])
}
