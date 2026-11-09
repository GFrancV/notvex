import type { PendingVault } from '@shared/types'

// Its own module so both file-opener.ts and ipc-handlers.ts can write it without importing
// each other. Read once by the next renderer that boots.
let pendingVault: PendingVault | null = null

export function setPendingVault(next: PendingVault): void {
  pendingVault = next
}

export function takePendingVault(): PendingVault | null {
  const p = pendingVault
  pendingVault = null
  return p
}
