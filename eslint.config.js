import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Standard convention: an underscore prefix on a destructured key,
      // catch binding, or function arg signals "I know this is unused on
      // purpose" (e.g. omitting a key with `const { [k]: _omit, ...rest } = obj`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // `react-refresh/only-export-components` is a Fast Refresh (dev HMR) hint,
    // not a correctness rule. These files intentionally export a component
    // alongside non-component values, and splitting them would fight the
    // established pattern:
    //   - badge/button: the shadcn convention of co-locating the cva variants
    //   - variable-chip-editor: document-variable helpers used across editors
    //   - WelcomeModal: a reset helper for the settings/help menu
    files: [
      'src/components/ui/badge.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/variable-chip-editor.tsx',
      'src/components/modals/WelcomeModal.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
