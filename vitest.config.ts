import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    // Vitest's defaults don't exclude .claude/ — a checked-out worktree
    // under .claude/worktrees/**/tests/*.test.ts would otherwise be
    // discovered and run as a second, independent copy of the whole suite.
    exclude: [...configDefaults.exclude, '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/renderer/src/components/ui/**']
    }
  }
})
