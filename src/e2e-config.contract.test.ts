import { expect, it } from 'vitest';
import config from '../vitest.e2e.config.js';

it('runs process e2e tests separately without coverage', () => {
  expect(config.test?.include).toEqual(['test/e2e/**/*.e2e.ts']);
  expect(config.test?.coverage).toEqual({ enabled: false });
});
