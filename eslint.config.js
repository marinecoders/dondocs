import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import security from 'eslint-plugin-security'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const workspaceImports = { paths: [
  { name: '@/stores/documentStore', importNames: ['loadSharedSession', 'replaceSessionState', 'resetDocumentHistory', 'installSessionState', 'prepareSessionState', 'restoreSession', 'rehydrateEnclosureFiles', 'persistUnsavedEnclosures'], message: 'Use the document lifecycle commands.' },
  { name: '@/stores/historyStore', importNames: ['useHistoryStore'], message: 'Use history commands and read-only availability hooks.' },
  { name: '@/stores', importNames: ['useHistoryStore'], message: 'Use history commands and read-only availability hooks.' },
], patterns: [
  { regex: '^(?:\\.\\.?/)+(?:.*/)?documentStore$', importNames: ['loadSharedSession', 'replaceSessionState', 'resetDocumentHistory', 'installSessionState', 'prepareSessionState', 'restoreSession', 'rehydrateEnclosureFiles', 'persistUnsavedEnclosures'], message: 'Use the document lifecycle commands.' },
  { regex: '^(?:\\.\\.?/)+(?:.*/)?historyStore$', importNames: ['useHistoryStore'], message: 'Use history commands and read-only availability hooks.' },
] }

export default defineConfig([
  // dist = build output; public/lib = vendored/generated runtime bundles
  // (pdf.js worker, swiftlatex, texlive, wasi shim, generated latex-templates)
  // — third-party/minified, not hand-maintained source.
  globalIgnores(['dist', 'dist-companion', 'dist-mcpb', 'public/lib/**', 'playwright-report/**', 'test-results/**']),
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
      // Native alert()/confirm()/prompt() follow the OS theme, not the app's
      // (a white popup over a dark UI). Use showAppAlert/showAppConfirm from
      // stores/alertStore instead — they render in the themed AppAlertDialog.
      'no-alert': 'error',
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
    files: ['src/lib/{capturedDocument,formExportTemplates,exportController,exportExecution,preparedExport,exportDeploymentPolicy,documentCapabilities,documentFieldPolicies,documentFields,documentSerialization,placeholders,workspaceSearch}.ts', 'src/services/pii/detector.ts', 'src/services/exports/{correspondence,builtinForms}.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        regex: '^(?:@/stores(?:/|$)|(?:\\.\\.?/)+(?:.*/)?stores(?:/|$))',
        allowTypeImports: true,
        message: 'Pass document data through an adapter instead of importing a live store.',
      }] }],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'fetch'],
      'no-restricted-properties': ['error', { object: 'Date', property: 'now', message: 'Pass the captured timestamp through the adapter.' }],
      'no-restricted-syntax': ['error', { selector: 'ImportExpression', message: 'Pure document models receive dependencies through their callers.' }],
    },
  },
  {
    // Migrated opening and history routes use the workspace commands.
    files: [
      'src/App.tsx',
      'src/components/layout/Header.tsx',
      'src/components/editor/GenericFormSection.tsx',
      'src/components/modals/{TemplateLoaderModal,DocumentGuideModal,ShareModal,RestoreSessionModal,ImportLetterModal}.tsx',
    ],
    rules: {
      'no-restricted-imports': ['error', workspaceImports],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.object.name=/^useDocuments?Store$/][callee.property.name='setState']", message: 'Use the document lifecycle commands.' },
        { selector: "MemberExpression[property.name=/^(applySnapshot|loadTemplate|resetForm|openLoadedAsNew|markBaseline)$/]", message: 'Use the document lifecycle commands.' },
        { selector: "AssignmentExpression[left.property.name=/^(currentId|activationEpoch)$/]", message: 'Identity belongs to the document lifecycle owner.' },
      ],
    },
  },
  {
    files: ['src/components/modals/ShareModal.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        ...workspaceImports,
        patterns: [...workspaceImports.patterns, {
          group: ['@/services/pii/detector', '@/services', '**/services/pii/detector', '**/services'],
          importNames: ['detectPII'],
          message: 'Inspect the captured shared payload with detectSharedSessionPII.',
        }],
      }],
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
