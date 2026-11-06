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
    const workflows = trackedFiles.filter((path) =>
      /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path),
    );
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

describe('secret scanning contract', () => {
  const ci = (): string => readTracked('.github/workflows/ci.yml');
  const scan = (): string => readTracked('scripts/secret-scan.sh');
  const jobBlock = (name: string): string => {
    const match = new RegExp(`^  ${name}:\\n((?:(?:    .*)?\\n)+)`, 'm').exec(ci());
    expect(match, `job ${name} must exist in ci.yml`).not.toBeNull();
    return match?.[1] ?? '';
  };

  it('runs a read-only secrets job with full history and no persisted credentials', () => {
    const job = jobBlock('secrets');
    expect(job).toMatch(/^ {4}permissions:\n {6}contents: read$/m);
    expect(job).toMatch(/uses: actions\/checkout@[0-9a-f]{40}\s+# v\d+\.\d+\.\d+\n\s+with:\n/);
    expect(job).toMatch(/^\s+fetch-depth: 0$/m);
    expect(job).toMatch(/^\s+persist-credentials: false$/m);
    expect(job).not.toMatch(/continue-on-error/);
    expect(job).not.toMatch(/\|\|\s*(true|:)/);
  });

  it('installs a pinned gitleaks release only after verifying its SHA-256', () => {
    const job = jobBlock('secrets');
    expect(job).toMatch(/^\s+GITLEAKS_VERSION: \d+\.\d+\.\d+$/m);
    expect(job).toMatch(/^\s+GITLEAKS_SHA256: [0-9a-f]{64}$/m);
    expect(job).toMatch(
      /releases\/download\/v\$\{GITLEAKS_VERSION\}\/gitleaks_\$\{GITLEAKS_VERSION\}_linux_x64\.tar\.gz/,
    );
    const verify = job.indexOf('sha256sum --check --strict');
    expect(verify).toBeGreaterThan(-1);
    expect(job.indexOf('tar -xzf')).toBeGreaterThan(verify);
  });

  it('keeps runner context out of job env and supplies the scanner path to both steps', () => {
    // This is a local regression guard, not an Actions expression validator.
    const job = jobBlock('secrets');
    const jobConfig = job.split(/^ {4}steps:/m)[0];
    expect(jobConfig).not.toMatch(/\$\{\{[^}]*\brunner\b/);
    expect(job).toMatch(/^ {10}"\$RUNNER_TEMP\/gitleaks" version$/m);
    const scannerSteps = job
      .split(/^ {6}- /m)
      .filter((step) =>
        /^ {8}run: bash scripts\/secret-scan(?:-merge-test|-suppression-test)?\.sh(?: self-test)?$/m.test(
          step,
        ),
      );
    expect(scannerSteps).toHaveLength(4);
    for (const step of scannerSteps) {
      expect(step).toMatch(/^ {8}env:\n {10}GITLEAKS_BIN: \$\{\{ runner\.temp \}\}\/gitleaks$/m);
    }
    const scanStep = scannerSteps.find((step) =>
      /^ {8}run: bash scripts\/secret-scan\.sh$/m.test(step),
    );
    expect(scanStep).toMatch(
      /^ {10}SCAN_BASE: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}$/m,
    );
    expect(scanStep).toMatch(
      /^ {10}SCAN_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}$/m,
    );
  });

  it('scans the whole change range, not only HEAD, and fails the job on a finding', () => {
    const job = jobBlock('secrets');
    expect(job).toContain('scripts/secret-scan.sh');
    expect(job).toContain('github.event.pull_request.base.sha');
    expect(job).toContain('github.event.pull_request.head.sha');
    expect(job).toContain('github.event.before');
    const script = scan();
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(script).toMatch(/gitleaks.*\bgit\b.*--exit-code 1.*--log-opts/s);
    expect(script).toMatch(/range="\$\{base\}\.\.\$\{head\}"/);
    expect(script).not.toMatch(/--no-git|--exit-code 0|\|\|\s*(true|:)/);
  });

  it('keeps merge and text patches enabled and the behavioral regression fixture tracked', () => {
    expect(scan()).toContain('--log-opts="--diff-merges=first-parent --text $range"');
    expect(trackedFiles).toContain('scripts/secret-scan-merge-test.sh');
  });

  it('proves on every run that the scanner fails on a synthetic secret', () => {
    expect(jobBlock('secrets')).toMatch(/scripts\/secret-scan\.sh self-test/);
    const script = scan();
    expect(script).toMatch(/self-test\)/);
    expect(script).toMatch(/rc" -eq 1/);
    expect(script).toMatch(/grep -Eq '\^RuleID: \+github-pat\$'/);
  });

  it('ignores inline allow comments and checkout config in scan and self-test', () => {
    const script = scan();
    const invocations = script
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#') && line.includes('"$gitleaks" git '));
    expect(invocations).toHaveLength(2);
    for (const invocation of invocations) {
      expect(invocation).toMatch(/ --ignore-gitleaks-allow(?: |$)/);
      expect(invocation).toContain(' --config "$config" ');
    }
    expect(script).toMatch(/^work="\$\(mktemp -d\)"$/m);
    expect(script).toMatch(/^config="\$work\/gitleaks\.toml"$/m);
    expect(script).toContain('printf \'[extend]\\nuseDefault = true\\n\' >"$config"');
    expect(trackedFiles).toContain('scripts/secret-scan-suppression-test.sh');
    expect(jobBlock('secrets')).toMatch(
      /^ {8}run: bash scripts\/secret-scan-suppression-test\.sh$/m,
    );
  });

  it('keeps default rules with only the two triaged public-demo fingerprints', () => {
    expect(trackedFiles.filter((path) => /(^|\/)\.?gitleaks[^/]*\.toml$/.test(path))).toEqual([]);
    const entries = readTracked('.gitleaksignore')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    expect(entries).toEqual([
      '2d68a4cf98e872cc5c13c9b5cab123f19cdbfacf:README.md:generic-api-key:62',
      '85bd973451be550d3a094f57a1d037b7061b0a2b:README.md:generic-api-key:62',
    ]);
    expect(scan()).not.toMatch(/--gitleaks-ignore-path|--baseline-path/);
  });
});
