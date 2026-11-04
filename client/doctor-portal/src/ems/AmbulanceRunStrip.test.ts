import { describe, expect, it } from 'vitest';
import type { EmsRunWithEvents } from '@medichain/shared';
import { recentRun } from './AmbulanceRunStrip';

const run = (id: string, created_at: string) => ({ id, created_at, events: [] }) as unknown as EmsRunWithEvents;

describe('recentRun', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  it('picks the newest run of the last day', () => {
    expect(recentRun([run('a', '2026-10-31T08:00:00Z'), run('b', '2026-10-31T10:00:00Z')], now)?.id).toBe('b');
  });
  it('ignores a run older than a day', () => {
    expect(recentRun([run('old', '2026-10-30T11:00:00Z')], now)).toBeNull();
  });
});
