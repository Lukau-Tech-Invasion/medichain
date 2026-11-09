import { describe, expect, it } from 'vitest';
import { groupByMonth } from './MyRecordsPage';

describe('records are newest first', () => {
  it('orders records from the same day by their time, not by where they came from', () => {
    const groups = groupByMonth([
      { id: 'lab', date: '2026-11-09T07:15:00.000Z' },
      { id: 'code-blue', date: '2026-11-09T09:41:00.000Z' },
      { id: 'yesterday', date: '2026-11-08T22:00:00.000Z' },
      { id: 'undated', date: '' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['2026-11', 'undated']);
    expect(groups[0].records.map((r) => r.id)).toEqual(['code-blue', 'lab', 'yesterday']);
  });
});
