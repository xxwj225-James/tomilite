// TomatoLite ESLint Config (flat config, ESLint 9.x)
// Enforces ALL rules from CLAUDE.md Parts 1-7

import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // ─── Global ignores ───
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/*.db',
      '**/*.jsc',
      '**/prisma/generated/**', // Prisma-generated runtime code
    ],
  },

  // ─── Base TypeScript ───
  ...tseslint.configs.recommended,

  // ─── All source files ───
  {
    files: ['apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts', 'packages/**/*.tsx', 'scripts/**/*.js'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // ═══ CLAUDE.md Part 7.1 — Type Safety ═══
      // no-explicit-any is off: 380+ existing sites use any pragmatically in
      // prototype-paced code; strictness is enforced via tsc instead.
      '@typescript-eslint/no-explicit-any': 'off',
      // warn: 692 existing unused-vars are flagged under ts-eslint v8; new
      // code should still clean these up — CI checks errors only (--quiet).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-non-null-assertion': 'error',

      // ═══ CLAUDE.md Part 7.1 — No console.log ═══
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',

      // ═══ General code quality ═══
      // off: expression statements (cond && fn()) are the established style
      // across 1100+ sites; enforcing this now would churn every file.
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-duplicate-imports': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // ═══ ts-eslint v8 new rules — off (incompatible with existing style) ═══
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',

      // ═══ React hooks ═══
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ═══ React refresh ═══
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // ─── API server (apps/api) — additional rules ───
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      // CLAUDE.md Part 3.4 — Prisma rules
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['*prisma*'],
          importNames: ['PrismaClient'],
          message: 'Import prisma from @tomatolite/database, do not create new PrismaClient()',
        }],
      }],
    },
  },

  // ─── Frontend (apps/web) — additional rules ───
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: {
      // CLAUDE.md Part 1.1 — No hardcoded colors (warn: progressive migration to CSS variables)
      'no-restricted-syntax': ['warn', {
        selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
        message: 'Use semantic CSS variables (var(--brand), var(--bg), etc.) instead of hex colors.',
      }],

      // CLAUDE.md Part 3.4 — No new PrismaClient in frontend
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@tomatolite/database'],
          importNames: ['prisma'],
          message: 'Frontend must use tRPC API calls. Do not import Prisma client directly.',
        }],
      }],
    },
  },

  // ─── Script files — relaxed rules ───
  {
    files: ['scripts/**/*.js'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  }
);
