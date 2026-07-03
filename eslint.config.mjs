// Root ESLint 9 flat config. Per-package configs (backend/, dashboard/,
// packages/*) import and extend this array — do not duplicate rules there.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      // Dart package — linted by flutter_lints, not ESLint
      'sdk/**',
      // Machine-local tooling dirs (gitignored, never in CI)
      '.claude/**',
      '.claude-flow/**',
      '.agents/**',
      '.swarm/**',
      '.superpowers/**',
      '.firebase/**',
      'images/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  // Must be last: disables stylistic rules that conflict with Prettier
  prettier,
);
