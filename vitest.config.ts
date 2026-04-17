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
      // Measured after notification-channels additions: 94.67 / 90.98 / 93.99 / 96.07.
      // Branches + functions dip with each new service whose uncovered
      // portion is pure subprocess plumbing (default runners for osascript /
      // notify-send / powershell). Worth covering in a later pass with
      // end-to-end subprocess tests; low-priority for correctness now.
      thresholds: {
        statements: 94,
        branches: 90,
        functions: 93,
        lines: 96,
      },
    },
  },
});
