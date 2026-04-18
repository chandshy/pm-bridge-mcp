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
      // Measured: statements 96.06, branches 93.24, functions 95.34, lines 96.49.
      // Branches dipped when fts-service.ts joined coverage — its native-dep
      // error paths are hard to exercise without actually breaking
      // better-sqlite3. Backfilled coverage can raise the floor in a later PR.
      thresholds: {
        statements: 95,
        branches: 93,
        functions: 94,
        lines: 96,
      },
    },
  },
});
