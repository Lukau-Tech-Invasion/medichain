import { describe, expect, it } from 'vitest';
import { formatHealthId } from '@medichain/shared';

describe('formatHealthId', () => {
  it('keeps the prefix and groups the rest in fours', () => {
    expect(formatHealthId('MC-7F3A9C210B44')).toBe('MC-7F3A 9C21 0B44');
    expect(formatHealthId('PAT-1234-5678-90')).toBe('PAT-1234 5678 90');
  });
  it('groups an id without a prefix, and leaves nothing as nothing', () => {
    expect(formatHealthId('ABCDEFGH')).toBe('ABCD EFGH');
    expect(formatHealthId(undefined)).toBe('');
  });
});
