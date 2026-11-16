import { describe, expect, it } from 'vitest'

import { formatFileSize } from '@/lib/utils'

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [104857600, '100 MB'],
    [13002342, '12.4 MB'],
    [1610612736, '1.5 GB']
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected)
  })
})
