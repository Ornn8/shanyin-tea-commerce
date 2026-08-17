import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/generated/**',
    // Runtime-generated test artifacts must not be linted after local e2e runs.
    'e2e/playwright-report/**',
    'e2e/screenshots/**',
    'test-results/**',
    'coverage/**',
  ]),
]);

export default eslintConfig;
