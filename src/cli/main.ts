#!/usr/bin/env node

if (process.argv.length > 2) {
  console.error('Unknown command. Usage: klag list|get|set|doctor');
  process.exitCode = 1;
} else {
  console.log('Usage: klag list|get|set|doctor');
  process.exitCode = 0;
}

export {};
