import { expect, it } from 'vitest';
import { InMemoryAuditSink } from './memory-sink.js';

it('appends in order and returns a copy of all lines', () => {
  const sink = new InMemoryAuditSink();
  expect(sink.readAll()).toEqual([]);
  sink.append('canary-one');
  sink.append('canary-two');
  sink.readAll().push('canary-outside');
  expect(sink.readAll()).toEqual(['canary-one', 'canary-two']);
});
