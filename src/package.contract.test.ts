import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

it('packs exactly the license, README, manifest and built dist files with an executable CLI', () => {
  const [pack] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      encoding: 'utf8',
    }),
  ) as { files: { path: string }[] }[];
  const actual = pack!.files.map(({ path }) => path).sort();
  const built = readdirSync('dist', { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/'));
  expect(built.length).toBeGreaterThan(0);
  expect(actual).toEqual(['package.json', 'README.md', 'LICENSE', ...built].sort());
  expect(
    actual.every((path) => !/(?:^|\/)(?:src|test|\.superpowers)\/|\.test\.|\.config\./.test(path)),
  ).toBe(true);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { bin: { klag: string } };
  expect(pkg.bin.klag).toMatch(/^dist\/.+\.js$/);
  expect(actual).toContain(pkg.bin.klag);
  expect(readFileSync(pkg.bin.klag, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
});
