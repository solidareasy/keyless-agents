import process from 'node:process';
import { env } from 'node:process';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (env.TAG !== `v${version}`) {
  process.stderr.write(`Expected tag v${version}; TAG must match the package version exactly.\n`);
  process.exitCode = 1;
}
