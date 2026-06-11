import { type JSX, useState } from 'react'

import { KeyRoundIcon, TriangleAlertIcon, XIcon } from 'lucide-react'

import { notvex } from '@/lib/ipc'
import { Field } from './ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'

interface KeyFileInputProps {
  value: string | null
  onChange: (contents: Uint8Array, filename: string) => void
  onClear?: () => void
  disabled?: boolean
}

export function KeyFileInput({
  value,
  onChange,
  onClear,
  disabled
}: KeyFileInputProps): JSX.Element {
  const [attemptedFilename, setAttemptedFilename] = useState<string | null>(null)
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [prevValue, setPrevValue] = useState(value)

  if (prevValue !== value) {
    setPrevValue(value)
    if (value === null) {
      setAttemptedFilename(null)
      setSizeBytes(null)
    }
  }

  const handleBrowse = async (): Promise<void> => {
    const res = await notvex.vault.selectKeyFile()
    if (!res.success || !res.data) return
    const { contents, filename, sizeBytes: size } = res.data
    setAttemptedFilename(filename)
    setSizeBytes(size)
    if (size > 0) {
      onChange(contents, filename)
    }
  }

  const handleClear = (): void => {
    setAttemptedFilename(null)
    setSizeBytes(null)
    onClear?.()
  }

  const displayName = attemptedFilename ?? value ?? ''
  const hasFile = displayName !== ''

  return (
    <Field>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <KeyRoundIcon />
        </InputGroupAddon>
        <InputGroupInput
          readOnly
          value={hasFile ? displayName : ''}
          placeholder="No file selected"
          className="cursor-default"
        />
        <InputGroupAddon align="inline-end">
          {hasFile && (
            <InputGroupButton onClick={handleClear} disabled={disabled}>
              <XIcon />
            </InputGroupButton>
          )}
          <InputGroupButton onClick={(): void => void handleBrowse()} disabled={disabled}>
            Browse
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {sizeBytes === 0 && (
        <p className="text-destructive flex items-center text-xs">
          <XIcon className="mr-1 inline size-4" /> Key file is empty. Select a different file.
        </p>
      )}
      {sizeBytes !== null && sizeBytes > 1_048_576 && (
        <p className="text-warning flex items-center text-xs">
          <TriangleAlertIcon className="mr-1 inline size-4" />
          This file is larger than 1MB. Only the first 1MB will be used.
        </p>
      )}
    </Field>
  )
}
