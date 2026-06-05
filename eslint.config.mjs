import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import importPlugin from 'eslint-plugin-import'
import unicornPlugin from 'eslint-plugin-unicorn'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettierConfig from 'eslint-config-prettier'

const sharedTypescriptRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/explicit-function-return-type': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
  ],
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/prefer-nullish-coalescing': 'error',
  '@typescript-eslint/prefer-optional-chain': 'error',
}

const sharedGeneralRules = {
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'prefer-const': 'error',
  'no-var': 'error',
  eqeqeq: 'error',
  curly: 'error',
}

const sharedUnicornRules = {
  'unicorn/no-null': 'off',
  'unicorn/prevent-abbreviations': 'off',
  'unicorn/filename-case': ['error', { case: 'kebabCase' }],
  'unicorn/no-array-for-each': 'error',
  'unicorn/prefer-module': 'error',
}

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────────────
  {
    ignores: ['node_modules/**', 'out/**', 'dist/**', '*.tsbuildinfo'],
  },

  // ── Base JS rules ────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── Main process + Preload (Node.js) ────────────────────────────────────
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'electron.vite.config.ts'],
    extends: tseslint.configs.recommendedTypeChecked,
    plugins: {
      import: importPlugin,
      unicorn: unicornPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.node.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.node.json',
        },
      },
    },
    rules: {
      ...sharedTypescriptRules,
      ...sharedGeneralRules,
      ...sharedUnicornRules,
      // Prevent process.exit() — use app.quit() in Electron main process
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.object.name="process"][callee.property.name="exit"]',
          message: 'Use app.quit() instead of process.exit() in Electron main process.',
        },
      ],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
    },
  },

  // ── Renderer + Shared (Browser + React) ─────────────────────────────────
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked, jsxA11y.flatConfigs.recommended],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      import: importPlugin,
      unicorn: unicornPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.web.json',
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        crypto: 'readonly',
      },
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        typescript: {
          project: './tsconfig.web.json',
        },
      },
    },
    rules: {
      ...sharedTypescriptRules,
      ...sharedGeneralRules,
      ...sharedUnicornRules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/self-closing-comp': 'error',
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
      'react/no-array-index-key': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [
            { pattern: 'react', group: 'external', position: 'before' },
            { pattern: 'react-*', group: 'external', position: 'before' },
            { pattern: '@shared/**', group: 'internal', position: 'after' },
            { pattern: '@/**', group: 'internal', position: 'after' },
            { pattern: '@renderer/**', group: 'internal', position: 'after' },
          ],
          pathGroupsExcludedImportTypes: ['react'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
    },
  },

  // ── Prettier last — disables all formatting rules ────────────────────────
  prettierConfig,
)
