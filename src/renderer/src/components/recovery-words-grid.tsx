import { type JSX } from 'react'

import { CheckIcon, CopyIcon, ExternalLinkIcon, ShieldIcon } from 'lucide-react'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { notvex } from '@/lib/ipc'

import { Button } from './ui/button'

const SECURITY_PRACTICES_URL = 'https://notvex.vercel.app/docs/security-practices'

interface RecoveryWordsGridProps {
  mnemonic: string
}

export function RecoveryWordsGrid({ mnemonic }: RecoveryWordsGridProps): JSX.Element {
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  const words = mnemonic.trim().split(/\s+/)

  return (
    <div className="space-y-3">
      <div className="bg-input/30 rounded-lg border p-4">
        <div className="grid grid-cols-6 gap-2">
          {words.map((word, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <span className="text-muted text-[10px]">{i + 1}</span>
              <span className="text-primary font-mono text-xs">{word}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Button
          variant="outline"
          onClick={() => void copyToClipboard(mnemonic, { secret: true })}
          className="w-full"
        >
          {isCopied ? (
            <>
              <CheckIcon className="text-success h-4 w-4" />
              Copied!
            </>
          ) : (
            <>
              <CopyIcon className="h-4 w-4" />
              Copy to clipboard
            </>
          )}
        </Button>
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <ShieldIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            Copied text can be read by other apps until it&apos;s cleared. Notvex clears it after
            30&nbsp;s and keeps it out of clipboard history where supported.{' '}
            <Button
              variant="link"
              className="h-auto gap-1 p-0 text-xs font-normal"
              onClick={() => void notvex.shell.openExternal(SECURITY_PRACTICES_URL)}
              aria-label="How Notvex protects copies (opens in your browser)"
            >
              How Notvex protects copies
              <ExternalLinkIcon className="size-3" aria-hidden />
            </Button>
          </span>
        </p>
      </div>
    </div>
  )
}
