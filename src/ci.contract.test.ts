import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

function readTracked(path: string): string {
  expect(trackedFiles).toContain(path);
  return readFileSync(path, 'utf8');
}

describe('supply chain contract', () => {
  it('pins every workflow action to a commit with a version comment', () => {
    const workflows = trackedFiles.filter((path) => /^\.github\/workflows\/[^/]+\.yml$/.test(path));
    expect(workflows.length).toBeGreaterThan(0);
    for (const path of workflows) {
      const uses = [...readTracked(path).matchAll(/^\s*(?:-\s*)?uses:\s*(.+)$/gm)];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, reference] of uses) {
        expect(reference).toMatch(/^[\w./-]+@[0-9a-f]{40}\s+# v\d+\.\d+\.\d+$/);
      }
    }
  });

  it('keeps a runtime dependency-free package and exact development tools', () => {
    const pkg = JSON.parse(readTracked('package.json')) as {
      devDependencies: Record<string, string>;
      packageManager: string;
      engines: { node: string };
    };
    expect(pkg).not.toHaveProperty('dependencies');
    expect(Object.keys(pkg.devDependencies).length).toBeGreaterThan(0);
    for (const version of Object.values(pkg.devDependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(pkg.packageManager).toBe('pnpm@10.28.0');
    expect(pkg.engines.node).toBe('>=22');
    expect(trackedFiles).toContain('pnpm-lock.yaml');
  });

  it('keeps generated files and local execution artifacts out of git', () => {
    expect(
      trackedFiles.filter((path) => /^(node_modules|dist|coverage|\.superpowers)\//.test(path)),
    ).toEqual([]);
  });
});
