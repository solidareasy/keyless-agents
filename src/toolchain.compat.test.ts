import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('lint toolchain glob compatibility', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'klag-toolchain-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeFixtureFile(name: string, source: string): Promise<void> {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }

  it('enumerates globstar/brace paths and applies extglobs, dotfiles and negated ignores', async () => {
    for (const name of [
      'src/active.js',
      'src/deep/other.mjs',
      'src/.hidden/active.js',
      'src/ignored/skip.js',
      'src/ignored/keep.js',
      'dist/active.js',
    ]) {
      await writeFixtureFile(name, 'debugger;');
    }
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        { ignores: ['dist/**'] },
        {
          files: ['src/**/+(active|other|skip|keep).{js,mjs}'],
          ignores: ['src/ignored/**', '!src/ignored/keep.js'],
          rules: { 'no-debugger': 'error' },
        },
      ],
    });
    const results = await eslint.lintFiles(['**/*.{js,mjs}']);
    expect(
      results
        .map((result) => ({
          file: path.relative(root, result.filePath).split(path.sep).join('/'),
          rules: result.messages.map((message) => message.ruleId),
        }))
        .sort((a, b) => a.file.localeCompare(b.file)),
    ).toEqual([
      { file: 'src/.hidden/active.js', rules: ['no-debugger'] },
      { file: 'src/active.js', rules: ['no-debugger'] },
      { file: 'src/deep/other.mjs', rules: ['no-debugger'] },
      { file: 'src/ignored/keep.js', rules: ['no-debugger'] },
      { file: 'src/ignored/skip.js', rules: [] },
    ]);
    expect(await eslint.isPathIgnored(path.join(root, 'dist/active.js'))).toBe(true);
  });

  it('selects configured and allowlisted project-service files but rejects nonmatching files', async () => {
    await writeFixtureFile('tsconfig.json', JSON.stringify({ include: ['included/**/*.ts'] }));
    for (const name of ['included/main.ts', 'loose/.config.ts', 'loose/rejected.ts']) {
      await writeFixtureFile(name, 'await 1; export {};');
    }
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
              tsconfigRootDir: root,
              projectService: { allowDefaultProject: ['loose/+(config|.config).{ts,cts}'] },
            },
          },
          plugins: { '@typescript-eslint': tseslint.plugin },
          rules: { '@typescript-eslint/await-thenable': 'error' },
        },
      ],
    });
    const results = await eslint.lintFiles(['**/*.ts']);
    for (const name of ['included/main.ts', 'loose/.config.ts']) {
      const result = results.find((entry) => entry.filePath === path.join(root, name));
      expect(result?.messages.map((message) => message.ruleId)).toEqual([
        '@typescript-eslint/await-thenable',
      ]);
      expect(result?.fatalErrorCount).toBe(0);
    }
    const rejected = results.find(
      (entry) => entry.filePath === path.join(root, 'loose/rejected.ts'),
    );
    expect(rejected?.fatalErrorCount).toBe(1);
    expect(rejected?.messages[0]?.message).toContain('does not match');
  });
});
