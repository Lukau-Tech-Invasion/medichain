import { describe, it, expect } from 'vitest';
import type { AccessLogEntry, RowVerification } from '@medichain/shared';
import { groupAccessSessions, kindOf, sealStateOf, verificationOf } from './accessHistoryGrouping';

/** Build one access-log row; `minute` is minutes after 14:00 on a fixed day. */
function row(id: string, minute: number, overrides: Partial<AccessLogEntry> = {}): AccessLogEntry {
  const timestamp = new Date(Date.UTC(2026, 8, 26, 12, minute)).toISOString();
  return {
    access_id: id,
    patient_id: 'PAT-001',
    accessor_id: 'user-dlamini',
    accessor_name: 'Dr N. Dlamini',
    accessor_role: 'Doctor',
    access_type: 'view',
    access_reason: 'Treatment',
    resource_type: 'Vital signs',
    location: 'Chris Hani Baragwanath',
    timestamp,
    emergency: false,
    seal_status: null,
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
      row('b', 1, { accessor_id: 'user-nurse', accessor_name: 'Nurse M. Khumalo', accessor_role: 'Nurse' }),
      row('c', 2, { access_reason: 'Referral' }),
      row('d', 3, { emergency: true, access_type: 'nfc_tap' }),
    ]);
    expect(sessions).toHaveLength(4);
  });

  it('keeps reads and changes apart so a write is never shown as "viewed"', () => {
    const sessions = groupAccessSessions([row('a', 0), row('b', 1, { access_type: 'create_vitals' })]);
    expect(sessions.map((s) => s.kind).sort()).toEqual(['changed', 'viewed']);
  });

  it('does not merge a receipt request into a confirmed record-change session', () => {
    const sessions = groupAccessSessions([
      row('request', 0, { access_type: 'handoff_receipt_requested', resource_type: 'shift_handoff' }),
      row('write', 1, { access_type: 'create_soap_note' }),
    ]);
    expect(sessions.map(session => session.kind).sort()).toEqual(['changed', 'requested']);
  });

  it('says "Not stated" when no reason was recorded', () => {
    expect(groupAccessSessions([row('a', 0, { access_reason: null })])[0].reason).toBe('Not stated');
  });
});

describe('sealStateOf', () => {
  it('reports exported only when every row is exported, and sealed when every row is at least sealed', () => {
    const [exported] = groupAccessSessions([
      row('a', 0, { seal_status: 'exported' }),
      row('b', 1, { seal_status: 'exported' }),
    ]);
    const [sealed] = groupAccessSessions([
      row('a', 0, { seal_status: 'exported' }),
      row('b', 1, { seal_status: 'sealed' }),
    ]);
    expect(sealStateOf(exported)).toBe('exported');
    expect(sealStateOf(sealed)).toBe('sealed');
  });

  it('is pending when nothing is sealed and partial when only some rows are', () => {
    const [pending] = groupAccessSessions([row('a', 0, { seal_status: 'pending' }), row('b', 1, { seal_status: 'pending' })]);
    const [partial] = groupAccessSessions([row('a', 0, { seal_status: 'sealed' }), row('b', 1, { seal_status: 'pending' })]);
    expect(sealStateOf(pending)).toBe('pending');
    expect(sealStateOf(partial)).toBe('partial');
  });

  it('says nothing when the server reported no state for any row', () => {
    const [none] = groupAccessSessions([row('a', 0), row('b', 1, { seal_status: undefined })]);
    expect(sealStateOf(none)).toBeNull();
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

describe('verificationOf', () => {
  const verification = (id: string, overrides: Partial<RowVerification> = {}): RowVerification => ({
    access_log_id: id,
    accessed_at: '2026-09-26T12:00:00Z',
    integrity: 'intact',
    batch_id: 1,
    leaf_index: 0,
    merkle_root: 'ab'.repeat(32),
    proof: [],
    seal_status: 'sealed',
    batch_hash: 'cd'.repeat(32),
    signature: 'valid',
    sealed_at: '2026-09-26T13:00:00Z',
    exported_at: null,
    ...overrides,
  });

  it('is verified only when every row is intact, sealed and validly signed, naming the latest seal time', () => {
    const [session] = groupAccessSessions([row('a', 1), row('b', 2)]);
    const rows = new Map([
      ['a', verification('a', { sealed_at: '2026-09-26T13:00:00Z' })],
      ['b', verification('b', { seal_status: 'exported', sealed_at: '2026-09-26T14:00:00Z' })],
    ]);
    expect(verificationOf(session, rows)).toEqual({ state: 'verified', sealedAt: '2026-09-26T14:00:00Z' });
  });

  it('reads a batch sealed without a signature as a weaker state, not as verified', () => {
    const [session] = groupAccessSessions([row('a', 1), row('b', 2)]);
    const rows = new Map([
      ['a', verification('a')],
      ['b', verification('b', { signature: 'unsigned' })],
    ]);
    expect(verificationOf(session, rows).state).toBe('verified_unsigned');
  });

  it('flags an invalid signature on its own', () => {
    const [session] = groupAccessSessions([row('a', 1)]);
    expect(verificationOf(session, new Map([['a', verification('a', { signature: 'invalid' })]])).state).toBe('signature_invalid');
  });

  it('turns the whole session into a mismatch when one row fails', () => {
    const [session] = groupAccessSessions([row('a', 1), row('b', 2)]);
    const rows = new Map([
      ['a', verification('a')],
      ['b', verification('b', { integrity: 'mismatch' })],
    ]);
    expect(verificationOf(session, rows).state).toBe('mismatch');
  });

  it('does not call pending, unbatched or uncovered rows verified', () => {
    const [session] = groupAccessSessions([row('a', 1)]);
    expect(
      verificationOf(session, new Map([['a', verification('a', { seal_status: 'pending', signature: null })]])).state,
    ).toBe('not_sealed');
    expect(
      verificationOf(session, new Map([['a', verification('a', { integrity: 'unbatched', seal_status: null, signature: null })]])).state,
    ).toBe('not_sealed');
    expect(verificationOf(session, new Map()).state).toBe('not_checked');
  });
});
