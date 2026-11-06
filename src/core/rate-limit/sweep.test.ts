import { describe, expect, it } from 'vitest';
import { DEFAULT_SWEEP_WINDOW_MS, SweepDetector } from './sweep.js';

describe('SweepDetector', () => {
  it('uses a five-minute default window', () => {
    expect(DEFAULT_SWEEP_WINDOW_MS).toBe(300_000);
  });

  it('alerts once after all names, ignores unlisted names and rearms on the next list', () => {
    const detector = new SweepDetector(DEFAULT_SWEEP_WINDOW_MS, () => 0);
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    detector.onList('canary-a', ['a', 'b', 'c']);
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'b')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'd')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'c')).toEqual({ alert: true });
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    detector.onList('canary-a', ['a', 'b', 'c']);
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'b')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'c')).toEqual({ alert: true });
  });

  it.each([299_999, 300_000])('includes a completion at %i ms from list time', (elapsed) => {
    let t = 100;
    const detector = new SweepDetector(DEFAULT_SWEEP_WINDOW_MS, () => t);
    detector.onList('canary-a', ['a', 'b']);
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    t += elapsed;
    expect(detector.onGet('canary-a', 'b')).toEqual({ alert: true });
  });

  it('expires an incomplete sweep one millisecond after the window', () => {
    let t = 100;
    const detector = new SweepDetector(DEFAULT_SWEEP_WINDOW_MS, () => t);
    detector.onList('canary-a', ['a', 'b']);
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    t += 300_001;
    expect(detector.onGet('canary-a', 'b')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
  });

  it('uses the supplied window and replaces both names and timestamp on a new list', () => {
    let t = 0;
    const detector = new SweepDetector(10, () => t);
    detector.onList('canary-a', ['a', 'b']);
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    t = 9;
    detector.onList('canary-a', ['c']);
    t = 19;
    expect(detector.onGet('canary-a', 'b')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'c')).toEqual({ alert: true });
    detector.onList('canary-a', ['a']);
    t = 30;
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
  });

  it('never alerts for an empty list, including one replacing a previous list', () => {
    const detector = new SweepDetector(DEFAULT_SWEEP_WINDOW_MS, () => 0);
    detector.onList('canary-a', ['a']);
    detector.onList('canary-a', []);
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'd')).toEqual({ alert: false });
  });

  it('isolates last lists and get progress between two sandboxes', () => {
    const detector = new SweepDetector(DEFAULT_SWEEP_WINDOW_MS, () => 0);
    detector.onList('canary-a', ['a', 'b']);
    detector.onList('canary-b', ['a', 'b']);
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    expect(detector.onGet('canary-b', 'b')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'b')).toEqual({ alert: true });
    expect(detector.onGet('canary-b', 'a')).toEqual({ alert: true });
  });

  it('snapshots the last list as a set without retaining the caller array', () => {
    const detector = new SweepDetector(DEFAULT_SWEEP_WINDOW_MS, () => 0);
    const names = ['a', 'a', 'b'];
    detector.onList('canary-a', names);
    names.push('c');
    expect(detector.onGet('canary-a', 'a')).toEqual({ alert: false });
    expect(detector.onGet('canary-a', 'b')).toEqual({ alert: true });
  });
});
