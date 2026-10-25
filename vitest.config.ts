import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/support/global-setup.ts',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
        'src/core/policy/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
        'src/core/audit/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
      },
    },
  },
});
