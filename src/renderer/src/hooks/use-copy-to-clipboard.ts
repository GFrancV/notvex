import { useCallback, useEffect, useState } from 'react'

import { toast } from 'sonner'

interface UseCopyToClipboardReturn {
  isCopied: boolean
  copyToClipboard: (content: string) => Promise<void>
}

export function useCopyToClipboard(): UseCopyToClipboardReturn {
  const [isCopied, setIsCopied] = useState(false)

  useEffect(() => {
    if (!isCopied) return

    const timer = setTimeout(() => setIsCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [isCopied])

  const copyToClipboard = useCallback(async (content: string): Promise<void> => {
    if (content === '') return

    try {
      await navigator.clipboard.writeText(content)
      toast.success('Copied to clipboard')
      setIsCopied(true)
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }, [])

  return { isCopied, copyToClipboard }
}
