import { type ReactNode, useState } from 'react'

import { CircleAlertIcon, FileKeyIcon, TriangleAlertIcon, XIcon } from 'lucide-react'

import { notvex } from '@/lib/ipc'
import { cn, formatFileSize } from '@/lib/utils'
import { InputGroup, InputGroupAddon, InputGroupButton } from './ui/input-group'

interface KeyFileInputProps {
  onChange: (contents: Uint8Array, filename: string) => void
  onClear?: () => void
  disabled?: boolean
}

export function KeyFileInput({ onChange, onClear, disabled }: KeyFileInputProps): ReactNode {
  const [selectedFile, setSelectedFile] = useState<{
    filename: string
    sizeBytes: number
  } | null>(null)

  const handleBrowse = async (): Promise<void> => {
    const res = await notvex.vault.selectKeyFile()
    if (!res.success || !res.data) return
    const { contents, filename, sizeBytes } = res.data
    setSelectedFile({
      filename,
      sizeBytes
    })
    if (sizeBytes > 0) {
      onChange(contents, filename)
    }
  }

  const handleClear = (): void => {
    setSelectedFile(null)
    onClear?.()
  }

  const isFileEmpty = selectedFile?.sizeBytes === 0

  return (
    <div className="space-y-2">
      <InputGroup
        className={cn(
          'h-12',
          selectedFile && !isFileEmpty && 'border-primary',
          selectedFile && isFileEmpty && 'border-destructive'
        )}
      >
        <InputGroupAddon align="inline-start">
          <FileKeyIcon
            className={cn(
              selectedFile && !isFileEmpty && 'text-primary',
              selectedFile && isFileEmpty && 'text-destructive'
            )}
          />
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
            'Key file...'
          )}
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          {selectedFile ? (
            <InputGroupButton onClick={handleClear} disabled={disabled}>
              <XIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="outline"
              onClick={(): void => void handleBrowse()}
              disabled={disabled}
            >
              Browse
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>

      {selectedFile?.sizeBytes === 0 && (
        <div role="alert" className="text-destructive flex items-center gap-1.5 text-xs">
          <CircleAlertIcon className="size-3" /> Key file is empty. Select a different file.
        </div>
      )}
      {selectedFile && selectedFile.sizeBytes > 1_048_576 && (
        <div role="alert" className="text-warning flex items-center gap-1.5 text-xs">
          <TriangleAlertIcon className="size-3" />
          File is larger than 1MB. Only the first 1MB will be used.
        </div>
      )}
    </div>
  )
}
