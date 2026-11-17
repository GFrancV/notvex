export interface KdfLevel {
  // The tier byte stored in the vault header; main maps it to Argon2 params.
  readonly id: number
  readonly memoryMiB: number
  readonly passes: number
}

// The only levels a vault can be created or changed to, lowest memory first.
export const KDF_LEVELS: readonly KdfLevel[] = [
  { id: 7, memoryMiB: 64, passes: 3 },
  { id: 5, memoryMiB: 128, passes: 3 },
  { id: 4, memoryMiB: 256, passes: 3 },
  { id: 2, memoryMiB: 512, passes: 3 }
]

export const DEFAULT_KDF_LEVEL_ID = 4
