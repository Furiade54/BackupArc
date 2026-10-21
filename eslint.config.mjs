import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['node_modules/**', '.vite/**', 'out/**', 'dist/**', 'build/**', 'coverage/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Proceso principal, preload, configuración y código compartido (Node/Electron)
    files: [
      'src/main/**/*.{ts,tsx}',
      'src/preload/**/*.{ts,tsx}',
      'src/shared/**/*.{ts,tsx}',
      'forge.config.ts',
      'vite.*.config.ts',
      'eslint.config.mjs',
      'scripts/**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Renderer: navegador (Chromium) con React
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // TypeScript ya valida identificadores; evita falsos positivos de no-undef
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
    },
  },
]);
