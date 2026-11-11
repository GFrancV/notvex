import type { VaultFileStatus } from '@shared/types'
import { vaultName } from './utils'

export type VaultFileProblem = Exclude<VaultFileStatus, 'usable'>

// One wording per case, for every place that reports it (unlock screen, vault menu, pickers).
export function vaultFileProblem(
  status: VaultFileProblem,
  path: string
): { title: string; body: string } {
  switch (status) {
    case 'missing':
      return {
        title: "Couldn't find this vault",
        body: `${vaultName(path)} isn't at ${path}. It may have been moved, renamed or be on a disconnected drive.`
      }
    case 'not-vault':
      return {
        title: "Couldn't open this vault",
        body: `The file at ${path} isn't a Notvex vault. It may have been replaced by another file.`
      }
    case 'unreadable':
      return {
        title: "Couldn't open this vault",
        body: `Notvex can't read ${path}. Check that it isn't open in another program and that you can access it.`
      }
  }
}
