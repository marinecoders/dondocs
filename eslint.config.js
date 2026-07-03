import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import security from 'eslint-plugin-security'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // dist = build output; public/lib = vendored/generated runtime bundles
  // (pdf.js worker, swiftlatex, texlive, wasi shim, generated latex-templates)
  // — third-party/minified, not hand-maintained source.
  globalIgnores(['dist', 'public/lib/**']),
  // Security linting across app + Node build scripts. The value here is the
  // low-noise sink rules that DON'T currently fire but guard future code:
  // eval-with-expression, child-process, non-literal-require,
  // pseudoRandomBytes, buffer-noassert, disable-mustache-escape, etc. Four
  // rules are turned off below as noise/redundant (see rationale inline).
  security.configs.recommended,
  {
    rules: {
      // Fires on nearly every `obj[key]` / `arr[i]` access (~98% false
      // positive here). Real prototype-pollution sinks are caught by review.
      'security/detect-object-injection': 'off',
      // Every fs call in this repo is build-time tooling (scripts/*, tests)
      // over trusted, code-derived paths — the browser app has no fs and takes
      // no untrusted filenames. All hits were false positives.
      'security/detect-non-literal-fs-filename': 'off',
      // ReDoS is covered authoritatively by CodeQL `js/redos` (runs in CI —
      // it's what hardened the signature-field regex in PR #69). safe-regex
      // additionally flags bounded, non-exploitable patterns; all current hits
      // were reviewed safe, so this rule is redundant noise on top of CodeQL.
      'security/detect-unsafe-regex': 'off',
      // Our only RegExp built from user input (FindReplaceModal) escapes every
      // metacharacter first; the rest clone internal constant regexes. The
      // rule can't see the escape, so it only nags on safe usage.
      'security/detect-non-literal-regexp': 'off',
    },
  },
  {
    // The fuzz helper embeds bidirectional-control characters on purpose (they
    // are the test input for our Trojan-Source handling), not a source-code
    // smuggling risk. Keep the rule on everywhere else.
    files: ['tests/**'],
    rules: { 'security/detect-bidi-characters': 'off' },
  },
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
