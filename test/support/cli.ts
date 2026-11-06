import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export function cli(
  url: string,
  auth: string,
  args: string[],
  stdin = '',
  imports: string[] = [],
  testEnv: Record<string, string> = {},
  entrypoint = resolve('dist/cli/main.js'),
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; errors: string[] }>(
    (resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        [...imports.flatMap((path) => ['--import', path]), entrypoint, ...args],
        {
          env: { KLAG_URL: url, KLAG_AUTH: auth, ...testEnv },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const errors: string[] = [];
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.stdin.on('error', (error: Error) => {
        errors.push(String(error), error.stack ?? '');
      });
      child.on('close', (code) => resolveResult({ code, stdout, stderr, errors }));
      child.stdin.end(stdin);
    },
  );
}
