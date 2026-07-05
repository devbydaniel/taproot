import eslint from '@eslint/js';
import noOnlyTests from 'eslint-plugin-no-only-tests';
import reactHooks from 'eslint-plugin-react-hooks';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // lint the three workspace source trees; config files and generated
    // artifacts (drizzle migrations, dist) stay out of scope
    ignores: ['**/dist/**', 'server/drizzle/**', 'data/**', '**/*.config.*'],
  },
  {
    files: [
      'shared/src/**/*.ts',
      'server/src/**/*.ts',
      'client/src/**/*.{ts,tsx}',
    ],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      sonarjs,
      'no-only-tests': noOnlyTests,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // correctness — catches bugs tsc accepts
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      'no-debugger': 'error',
      'no-only-tests/no-only-tests': 'error',

      // complexity — cognitive complexity is the primary gate,
      // cyclomatic and friends are cheap backstops
      'sonarjs/cognitive-complexity': ['error', 15],
      complexity: ['error', 15],
      'max-depth': ['error', 4],
      'max-params': ['error', 5],
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: true, skipComments: true },
      ],

      // local duplication (cross-file clones are jscpd's job)
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicated-branches': 'error',
    },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },

  // architecture boundaries (CLAUDE.md invariant 4)
  {
    files: ['shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', '@taproot/server', '@taproot/client'],
              message:
                'shared stays pure — no Node or workspace imports (invariant 4)',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@taproot/server',
              message:
                'client may only use the server type surface (import type)',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  // tests: relax rules that fight test idioms
  {
    files: ['**/*.test.ts'],
    rules: {
      'max-lines': 'off',
      'sonarjs/no-identical-functions': 'off',
    },
  },
);
