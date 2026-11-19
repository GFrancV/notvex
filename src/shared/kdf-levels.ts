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

export function isKdfLevelId(value: unknown): value is number {
  return KDF_LEVELS.some((level) => level.id === value)
}

// A level outside the four says its passes too, since they differ from the usual 3.
export function describeKdfLevel(level: KdfLevel): string {
  return isKdfLevelId(level.id)
    ? `${level.memoryMiB} MiB`
    : `${level.memoryMiB} MiB, ${level.passes} passes`
}

export type KdfMeasurement = { status: 'measured'; ms: number } | { status: 'unavailable' }
