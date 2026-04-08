import { describe, expect, it } from 'vitest';

import { secondsSince, truncateToHour } from '../../src/lib/time.js';

describe('truncateToHour', () => {
  it('removes minutes, seconds, and milliseconds in UTC', () => {
    const actual = truncateToHour(new Date('2026-04-08T12:34:56.789Z'));

    expect(actual.toISOString()).toBe('2026-04-08T12:00:00.000Z');
  });
});

describe('secondsSince', () => {
  it('returns the floor of elapsed seconds', () => {
    const now = new Date('2026-04-08T12:00:05.900Z');

    expect(secondsSince('2026-04-08T12:00:00.000Z', now)).toBe(5);
  });

  it('never returns a negative value', () => {
    const now = new Date('2026-04-08T12:00:00.000Z');

    expect(secondsSince('2026-04-08T12:00:10.000Z', now)).toBe(0);
  });
});
