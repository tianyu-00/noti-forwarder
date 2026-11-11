import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules', 'dist', 'dev-dist'] },
  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/prop-types': 'error',
      // Message text is untrusted: it must only ever be rendered as plain text.
      'react/no-danger': 'error',
    },
  },
  {
    files: ['test/**', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
];
