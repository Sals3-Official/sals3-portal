import { FlatCompat } from '@eslint/eslintrc';
import { fixupConfigRules } from '@eslint/compat';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier/flat';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const airbnbConfig = fixupConfigRules(
  compat.extends('airbnb', 'airbnb/hooks'),
).map((config) => {
  const configWithoutPlugins = { ...config };

  delete configWithoutPlugins.plugins;

  return configWithoutPlugins;
});

const eslintConfig = defineConfig([
  ...airbnbConfig,
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.{js,jsx,ts,tsx,mjs}'],
    settings: {
      react: {
        version: 'detect',
      },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
        node: true,
      },
    },
    rules: {
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          js: 'never',
          jsx: 'never',
          ts: 'never',
          tsx: 'never',
        },
      ],
      'react/jsx-filename-extension': [
        'error',
        {
          extensions: ['.jsx', '.tsx'],
        },
      ],
      'react/react-in-jsx-scope': 'off',
      'react/require-default-props': 'off',
    },
  },
  {
    files: [
      '*.config.{js,mjs,ts}',
      'eslint.config.mjs',
      'next.config.ts',
      'playwright.config.ts',
      'postcss.config.mjs',
      'vitest.config.mts',
    ],
    rules: {
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: true,
        },
      ],
    },
  },
  {
    files: [
      '**/*.test.{js,jsx,ts,tsx}',
      '**/*.spec.{js,jsx,ts,tsx}',
      'e2e/**/*.{js,jsx,ts,tsx}',
      'test/**/*.{js,jsx,ts,tsx}',
    ],
    rules: {
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: true,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    '.next-typecheck-tmp-*/**',
    'out/**',
    'build/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    '.obsidian/**',
    'docs/**',
    'next-env.d.ts',
    // docs/ is the Obsidian vault (notes + a vendored community plugin
    // bundle), not project source - never lint it.
    'docs/**',
  ]),
  prettierConfig,
]);

export default eslintConfig;
