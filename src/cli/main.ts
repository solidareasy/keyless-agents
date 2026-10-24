#!/usr/bin/env node

const command = process.argv[2];

if (command === undefined) {
  console.log('Usage: klag list|get|set|doctor');
  process.exitCode = 0;
} else {
  if (['list', 'get', 'set', 'doctor'].includes(command)) {
    console.error(`klag ${command}: not implemented yet. Usage: klag list|get|set|doctor`);
  } else {
    console.error('Unknown command. Usage: klag list|get|set|doctor');
  }
  process.exitCode = 1;
}

export {};
