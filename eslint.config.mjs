import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import unicorn from 'eslint-plugin-unicorn'
import { defineConfig } from 'eslint/config'

import colorTokens from './eslint-rules/color-tokens.mjs'
import noHistoryComments from './eslint-rules/no-history-comments.mjs'

const local = {
  rules: { 'color-tokens': colorTokens, 'no-history-comments': noHistoryComments }
}

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh,
      unicorn
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      'unicorn/filename-case': [
        'error',
        {
          cases: {
            kebabCase: true,
            pascalCase: true
          }
        }
      ]
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/components/ui/**'],
    plugins: { local },
    rules: { 'local/no-history-comments': 'error' }
  },
  {
    // shadcn primitives keep upstream classes; .ts files hold user-picked tag colors.
    files: ['src/renderer/src/**/*.tsx'],
    ignores: ['src/renderer/src/components/ui/**'],
    plugins: { local },
    rules: { 'local/color-tokens': 'error' }
  },
  {
    // Clipboard history and cloud sync are only opted out of when main writes the clipboard.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[property.name="clipboard"]:matches([object.name="navigator"], [object.property.name="navigator"])',
          message: 'Copy through useCopyToClipboard, which writes via main.'
        }
      ]
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/main/clipboard-guard.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              importNames: ['clipboard', 'ClipboardItem'],
              message: 'Write the clipboard through writeClipboard in clipboard-guard.ts.'
            }
          ]
        }
      ]
    }
  },
  {
    // Main-process errors can carry the vault path; log.ts is the one place that redacts them.
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/log.ts'],
    rules: { 'no-console': 'error' }
  },
  eslintConfigPrettier
)
