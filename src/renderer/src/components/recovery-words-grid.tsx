import { type JSX, useState } from 'react'

import { CheckIcon, CopyIcon } from 'lucide-react'

import { Button } from './ui/button'

interface RecoveryWordsGridProps {
  mnemonic: string
}

export function RecoveryWordsGrid({ mnemonic }: RecoveryWordsGridProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const words = mnemonic.trim().split(/\s+/)

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(mnemonic).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

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
      <Button variant="outline" onClick={handleCopy} className="w-full">
        {copied ? (
          <>
            <CheckIcon className="h-4 w-4 text-emerald-400" />
            Copied!
          </>
        ) : (
          <>
            <CopyIcon className="h-4 w-4" />
            Copy to clipboard
          </>
        )}
      </Button>
    </div>
  )
}
