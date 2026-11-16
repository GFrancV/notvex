import type { ReactNode } from 'react'

import { AlertTriangleIcon, ListXIcon } from 'lucide-react'

import { type VaultFileProblem, vaultFileProblem } from '@/lib/vault-file-problem'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
import { Button } from './ui/button'
import { FieldSeparator } from './ui/field'

interface UnopenableVaultProps {
  status: VaultFileProblem
  path: string
  retryFailed: boolean
  onRetry: () => void
  onRemove: () => void
  onOpenOther: () => void
  onCreateNew: () => void
}

export function UnopenableVault({
  status,
  path,
  retryFailed,
  onRetry,
  onRemove,
  onOpenOther,
  onCreateNew
}: UnopenableVaultProps): ReactNode {
  const problem = vaultFileProblem(status, path)

  return (
    <>
      <Alert variant="warning">
        <AlertTriangleIcon />
        <AlertTitle>{problem.title}</AlertTitle>
        <AlertDescription>{problem.body}</AlertDescription>
        <Button
          variant="ghost"
          size="sm"
          className="col-start-2 mt-2 justify-self-start"
          onClick={onRemove}
        >
          <ListXIcon />
          Remove from recent vaults
        </Button>
      </Alert>

      <Button className="mt-4 w-full" autoFocus onClick={onRetry}>
        Try again
      </Button>

      <p aria-live="polite" className="text-muted-foreground mt-2 text-center text-sm">
        {retryFailed && "Still couldn't open this vault"}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <FieldSeparator className="my-0 text-xs">or</FieldSeparator>
        <Button variant="outline" className="w-full" onClick={onOpenOther}>
          Open existing vault
        </Button>
        <p className="text-center">
          <Button
            variant="link"
            className="text-muted-foreground h-auto p-0 text-xs font-normal"
            onClick={onCreateNew}
          >
            Create new vault
          </Button>
        </p>
      </div>
    </>
  )
}
