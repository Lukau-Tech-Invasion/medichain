import { describe, it, expect } from 'vitest';
import type { AccessLogEntry } from '@medichain/shared';
import { anchorStateOf, groupAccessSessions, kindOf } from './accessHistoryGrouping';

/** Build one access-log row; `minute` is minutes after 14:00 on a fixed day. */
function row(id: string, minute: number, overrides: Partial<AccessLogEntry> = {}): AccessLogEntry {
  const timestamp = new Date(Date.UTC(2026, 8, 26, 12, minute)).toISOString();
  return {
    access_id: id,
    patient_id: 'PAT-001',
    accessor_id: 'wallet-dlamini',
    accessor_name: 'Dr N. Dlamini',
    accessor_role: 'Doctor',
    access_type: 'view',
    access_reason: 'Treatment',
    resource_type: 'Vital signs',
    location: 'Chris Hani Baragwanath',
    timestamp,
    emergency: false,
    blockchain_tx_hash: null,
    ...overrides,
  };
}

describe('groupAccessSessions', () => {
  it('folds one chart session into a single entry listing what was viewed', () => {
    const sessions = groupAccessSessions([
      row('a', 2),
      row('b', 5, { resource_type: 'Lab results' }),
      row('c', 9, { resource_type: 'Progress notes' }),
      row('d', 12, { resource_type: 'Lab results' }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].resources).toEqual(['Vital signs', 'Lab results', 'Progress notes']);
    expect(sessions[0].reason).toBe('Treatment');
    expect(sessions[0].rowCount).toBe(4);
  });

  it('starts a new session after a long pause, and lists newest first', () => {
    const sessions = groupAccessSessions([row('a', 0), row('b', 45)]);
    expect(sessions.map((s) => s.key)).toEqual(['b', 'a']);
  });

  it('never merges different people, reasons or an emergency read', () => {
    const sessions = groupAccessSessions([
      row('a', 0),
      row('b', 1, { accessor_id: 'wallet-nurse', accessor_name: 'Nurse M. Khumalo', accessor_role: 'Nurse' }),
      row('c', 2, { access_reason: 'Referral' }),
      row('d', 3, { emergency: true, access_type: 'nfc_tap' }),
    ]);
    expect(sessions).toHaveLength(4);
  });

  it('keeps reads and changes apart so a write is never shown as "viewed"', () => {
    const sessions = groupAccessSessions([row('a', 0), row('b', 1, { access_type: 'create_vitals' })]);
    expect(sessions.map((s) => s.kind).sort()).toEqual(['changed', 'viewed']);
  });

  it('says "Not stated" when no reason was recorded', () => {
    expect(groupAccessSessions([row('a', 0, { access_reason: null })])[0].reason).toBe('Not stated');
  });
});

describe('anchorStateOf', () => {
  it('reports anchored only when every row has a transaction', () => {
    const [all] = groupAccessSessions([
      row('a', 0, { blockchain_tx_hash: '0xabc' }),
      row('b', 1, { blockchain_tx_hash: '0xdef' }),
    ]);
    const [some] = groupAccessSessions([row('a', 0, { blockchain_tx_hash: '0xabc' }), row('b', 1)]);
    const [none] = groupAccessSessions([row('a', 0)]);
    expect(anchorStateOf(all)).toBe('anchored');
    expect(anchorStateOf(some)).toBe('partial');
    expect(anchorStateOf(none)).toBe('pending');
  });
});

describe('kindOf', () => {
  it('treats emergency taps and downloads as reads', () => {
    expect(kindOf('nfc_tap')).toBe('viewed');
    expect(kindOf('download_record')).toBe('viewed');
    expect(kindOf('update_consent')).toBe('changed');
    // Inclusion in a research export is neither a read nor a change.
    expect(kindOf('research_export_included')).toBe('research');
  });
});
