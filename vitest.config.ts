import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/test/**',
      ],
      // Minimum coverage thresholds — CI will fail if these are not met.
      // Set conservatively below current measured levels; raise as coverage improves.
      // Current measured: statements 94.98%, branches 92.16%, functions 95.52%, lines 96.28%.
      // Branches dropped when the OAuth 2.1 authorization-server code joined
      // coverage — its error-path branches (malformed bodies, token resource
      // mismatch, spawn errors) are disproportionately hard to exercise
      // without stubbing node internals. A follow-up PR can backfill.
      thresholds: {
        statements: 94,
        branches: 92,
        functions: 94,
        lines: 96,
      },
    },
  },
});
