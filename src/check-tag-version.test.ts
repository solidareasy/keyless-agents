import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

it.each([
  [`v${version}`, 0],
  ['v999.999.999', 1],
  [version, 1],
  ['', 1],
])('validates tag %s against the package version', (tag, status) => {
  const result = spawnSync(process.execPath, ['scripts/check-tag-version.mjs'], {
    env: { TAG: tag },
    encoding: 'utf8',
  });
  expect(result.status).toBe(status);
  if (status !== 0) expect(result.stderr).toContain(`Expected tag v${version}`);
});
