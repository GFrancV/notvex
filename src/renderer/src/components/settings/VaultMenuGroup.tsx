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
import { notvex } from '@/lib/ipc'
import { truncatePath } from '@/lib/utils'

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
      <DropdownMenuItem className="text-primary" onClick={handleOpenBackupsFolder}>
        Open backups folder
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}
