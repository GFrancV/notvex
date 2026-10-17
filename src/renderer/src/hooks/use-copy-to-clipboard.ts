import { useCallback, useEffect, useState } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'

interface UseCopyToClipboardReturn {
  isCopied: boolean
  copyToClipboard: (content: string, opts?: { secret?: boolean }) => Promise<void>
}

export function useCopyToClipboard(): UseCopyToClipboardReturn {
  const [isCopied, setIsCopied] = useState(false)

  useEffect(() => {
    if (!isCopied) return

    const timer = setTimeout(() => setIsCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [isCopied])

  const copyToClipboard = useCallback(
    async (content: string, { secret = false } = {}): Promise<void> => {
      if (content === '') return

      const result = await notvex.clipboard
        .write(content, { secret })
        .catch(() => ({ success: false }) as const)
      if (!result.success) {
        toast.error('Failed to copy to clipboard')
        return
      }
      toast.success('Copied to clipboard')
      setIsCopied(true)
    },
    []
  )

  return { isCopied, copyToClipboard }
}
