import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'e2e',
    include: ['test/e2e/**/*.e2e.test.ts'],
    coverage: { enabled: false },
    testTimeout: 20000,
  },
});
