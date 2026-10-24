import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe('CLI scaffold', () => {
  it.each(['list', 'get', 'set', 'doctor'])(
    'reports %s as not implemented with usage code 1',
    async (command) => {
      process.argv = ['node', 'klag', command];
      await import('./main.js');
      expect(console.error).toHaveBeenCalledWith(
        `klag ${command}: not implemented yet. Usage: klag list|get|set|doctor`,
      );
      expect(console.log).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );

  it('prints help and exits successfully without a command', async () => {
    process.argv = ['node', 'klag'];
    await import('./main.js');
    expect(console.log).toHaveBeenCalledWith('Usage: klag list|get|set|doctor');
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('reports unknown commands on stderr and exits with usage code 1', async () => {
    process.argv = ['node', 'klag', 'bogus'];
    await import('./main.js');
    expect(console.error).toHaveBeenCalledWith('Unknown command. Usage: klag list|get|set|doctor');
    expect(console.log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
