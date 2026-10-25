import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readTracked(path: string): string {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
  expect(tracked).toContain(path);
  return readFileSync(path, 'utf8');
}

function section(text: string, heading: string, indent: number): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`${' '.repeat(indent)}${heading}:`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end]!.trim() === '' || lines[end]!.startsWith(' '.repeat(indent + 1)))
  )
    end++;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trimEnd();
}

describe('release workflow contract', () => {
  it('triggers exclusively on v* tag pushes with concurrency per tag and read-only defaults', () => {
    const cd = readTracked('.github/workflows/cd.yml');
    expect(section(cd, 'on', 0)).toBe("  push:\n    tags: ['v*']");
    expect(section(cd, 'permissions', 0)).toBe('  contents: read');
    expect(section(cd, 'concurrency', 0)).toContain('${{ github.ref }}');
    expect([...section(cd, 'jobs', 0).matchAll(/^  (\w+):$/gm)].map((match) => match[1])).toEqual([
      'verify',
      'publish',
    ]);
  });

  it('pins every action to the CI SHA and version and disables checkout credentials', () => {
    const cd = readTracked('.github/workflows/cd.yml');
    const ci = readTracked('.github/workflows/ci.yml');
    const actions = [...cd.matchAll(/^\s*- uses: (.+)$/gm)];
    expect(actions).toHaveLength(6);
    for (const [, action] of actions) {
      expect(action).toMatch(/^[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      expect(ci).toContain(`uses: ${action}`);
    }
    const checkouts = cd.split(/- uses: actions\/checkout@/).slice(1);
    expect(checkouts).toHaveLength(2);
    for (const checkout of checkouts) {
      expect(checkout.split(/\n\s*- /)[0]).toContain('persist-credentials: false');
    }
  });

  it('verifies the build and tag using an environment variable, with no expressions in run', () => {
    const cd = readTracked('.github/workflows/cd.yml');
    const verify = section(cd, 'verify', 2);
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm check',
      'pnpm build',
      'node scripts/check-tag-version.mjs',
    ]) {
      expect(verify).toContain(`run: ${command}`);
    }
    expect(verify).toContain('TAG: ${{ github.ref_name }}');
    expect(cd).toContain("node-version: '22'");
    for (const run of cd.matchAll(/^\s*- run: (.+)$/gm)) expect(run[1]).not.toContain('${{');
    expect(cd).not.toMatch(/run:\s*[|>]/);
  });

  it('grants OIDC only to the protected dry-run publish job and has no token or secret reference', () => {
    const cd = readTracked('.github/workflows/cd.yml');
    const publish = section(cd, 'publish', 2);
    expect(publish).toContain('needs: verify');
    expect(publish).toContain('environment: npm-publish');
    expect(section(publish, 'permissions', 4)).toBe('      contents: read\n      id-token: write');
    expect(cd.match(/id-token:/g)).toHaveLength(1);
    expect(publish).toContain('registry-url: https://registry.npmjs.org');
    expect(publish).toContain('run: pnpm install --frozen-lockfile');
    expect(publish).toContain('run: pnpm build');
    expect(publish).toContain('run: npm install -g npm@11.5.1');
    expect(publish).toContain('run: npm publish --provenance --access public --dry-run');
    expect(cd).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\.|workflow_dispatch/i);
  });
});
