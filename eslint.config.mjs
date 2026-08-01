import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { includeIgnoreFile } from '@eslint/compat';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default ts.config(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  // Must stay last: in flat config the later block wins, and these overrides used
  // to sit above ts.configs.recommended, which quietly reset them back to `error`.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Pre-existing debt, mostly in interfaces.ts and the Dennys response types.
      // Warn so CI stays honest about it without blocking unrelated work.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
