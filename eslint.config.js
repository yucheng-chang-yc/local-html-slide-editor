import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.data', 'return_package', 'fixtures', 'playwright-report', 'test-results', 'evidence'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/refs': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
  ,{
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } }
  }
);
