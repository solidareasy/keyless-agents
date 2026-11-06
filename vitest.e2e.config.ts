import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'e2e',
    globalSetup: './test/support/global-setup.ts',
    include: ['test/e2e/**/*.e2e.ts'],
    coverage: { enabled: false },
    testTimeout: 20000,
  },
});
