import type { ReactNode } from 'react'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { summarizeImport } from '@/lib/import-summary'
import { notvex } from '@/lib/ipc'
import { truncatePath } from '@/lib/utils'
import { useVaultStore } from '@/store/vault.store'

// The dropdown closes as soon as this item is clicked (standard menu
// behavior), so any loading state on the item itself is never visible — a
// persistent toast is the only feedback that survives the menu closing.
const handleSaveCopy = async (): Promise<void> => {
  const toastId = toast.loading('Saving a copy…')
  const result = await notvex.vault.saveCopyAs()
  if (!result.success) {
    toast.error('Failed to save copy', { id: toastId })
    return
  }
  if (result.data) {
    toast.success('Copy saved successfully', { id: toastId })
  } else {
    toast.dismiss(toastId) // user canceled the save dialog
  }
}

const handleImport = async (): Promise<void> => {
  const toastId = toast.loading('Importing notes…')
  const res = await notvex.notes.import()
  if (!res.success) {
    toast.error(res.error, { id: toastId })
    return
  }
  if (!res.data) {
    toast.dismiss(toastId) // user canceled the file dialog
    return
  }
  if (res.data.imported > 0) await useVaultStore.getState().refreshAll()
  const { message, details } = summarizeImport(res.data)
  if (details.length === 0) {
    toast.success(message, { id: toastId })
    return
  }
  toast.warning(message, {
    id: toastId,
    description: <span className="whitespace-pre-line">{details.join('\n')}</span>
  })
}

const handleOpenBackupsFolder = async (): Promise<void> => {
  const res = await notvex.vault.openBackupsFolder()
  if (!res.success) toast.error(res.error)
}

interface VaultMenuGroupProps {
  vaultPath: string
  /** Opens the plaintext warning, which the caller renders outside the dropdown. */
  onExportAll: () => void
}

// The settings dropdown's actions on the open vault file.
export function VaultMenuGroup({ vaultPath, onExportAll }: VaultMenuGroupProps): ReactNode {
  const { isCopied, copyToClipboard } = useCopyToClipboard()

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Vault Location</DropdownMenuLabel>
      <DropdownMenuItem>
        <InputGroup onClick={(e) => e.stopPropagation()}>
          <InputGroupInput readOnly value={truncatePath(vaultPath, 28)} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={() => copyToClipboard(vaultPath)} title="Copy to Clipboard">
              {isCopied ? <CheckIcon className="text-primary" /> : <CopyIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </DropdownMenuItem>
      <DropdownMenuItem className="text-primary" onClick={handleSaveCopy}>
        Save a vault copy as...
      </DropdownMenuItem>
      <DropdownMenuItem className="text-primary" onClick={onExportAll}>
        Export all notes…
      </DropdownMenuItem>
      <DropdownMenuItem className="text-primary" onClick={handleImport}>
        Import Markdown…
      </DropdownMenuItem>
      <DropdownMenuItem className="text-primary" onClick={handleOpenBackupsFolder}>
        Open backups folder
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}
