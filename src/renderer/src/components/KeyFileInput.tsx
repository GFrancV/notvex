import { type ReactNode, useState } from 'react'

import { FileKeyIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { cn } from 'cn'
import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { formatFileSize } from '@/lib/utils'
import { InputGroup, InputGroupAddon, InputGroupButton } from './ui/input-group'

interface KeyFileInputProps {
  onChange: (contents: Uint8Array, filename: string) => void
  onClear?: () => void
  disabled?: boolean
  /** A file already chosen elsewhere, shown as selected; the user can still clear or replace it. */
  initialFile?: { filename: string; sizeBytes: number }
  /** Focuses Browse on mount, for when choosing the file is the first thing to do. */
  autoFocus?: boolean
}

export function KeyFileInput({
  onChange,
  onClear,
  disabled,
  initialFile,
  autoFocus
}: KeyFileInputProps): ReactNode {
  const [selectedFile, setSelectedFile] = useState<{
    filename: string
    sizeBytes: number
  } | null>(initialFile ?? null)

  const handleBrowse = async (): Promise<void> => {
    const res = await notvex.vault.selectKeyFile()
    if (!res.success) {
      toast.error(res.error)
      return
    }
    if (!res.data) return
    const { contents, filename, sizeBytes } = res.data
    setSelectedFile({ filename, sizeBytes })
    onChange(contents, filename)
  }

  const handleClear = (): void => {
    setSelectedFile(null)
    onClear?.()
  }

  return (
    <div className="space-y-2">
      <InputGroup className={cn('h-12', selectedFile && 'border-primary')}>
        <InputGroupAddon align="inline-start">
          <FileKeyIcon className={cn(selectedFile && 'text-primary')} />
        </InputGroupAddon>
        <InputGroupAddon className="flex-1 cursor-default flex-col items-start justify-start gap-0">
          {selectedFile ? (
            <>
              <span className="text-foreground">{selectedFile.filename}</span>
              <span className="text-muted-foreground text-xs">
                {formatFileSize(selectedFile.sizeBytes)}
              </span>
            </>
          ) : (
            'Key file…'
          )}
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          {selectedFile ? (
            <InputGroupButton onClick={handleClear} disabled={disabled} aria-label="Clear key file">
              <XIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="outline"
              autoFocus={autoFocus}
              onClick={(): void => void handleBrowse()}
              disabled={disabled}
            >
              Browse
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>

      {selectedFile && selectedFile.sizeBytes > 1_048_576 && (
        <div role="alert" className="text-warning flex items-center gap-1.5 text-xs">
          <TriangleAlertIcon className="size-3" />
          File is larger than 1MB. Only the first 1MB will be used.
        </div>
      )}
    </div>
  )
}
