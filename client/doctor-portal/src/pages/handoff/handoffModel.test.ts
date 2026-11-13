import { describe, expect, it } from 'vitest';
import type { HandoffDraftPatient } from '@medichain/shared';
import { blankPatient, fromDraft, listStatus, nextToReview, toPayload } from './handoffModel';

const drafted: HandoffDraftPatient = {
  patient_id: 'P1',
  full_name: 'Thandiwe Nkosi',
  date_of_birth: '1992-03-12',
  bed_label: '12',
  recorded: [{ resource_type: 'vital_signs', count: 9, last_at: null }, { resource_type: 'mar', count: 5, last_at: null }],
  content: 'included',
  sbar: {
    situation: [{ text: 'BP 148/92 · HR 104', source: 'vitals', at: '2026-11-08T14:00:00Z' }],
    background: [{ text: 'Allergies: Penicillin', source: 'chart', at: null }],
    assessment: [],
    recommendation: [{ text: 'HbA1c — lab order pending', source: 'order', at: '2026-11-08T07:15:00Z' }],
  },
};

describe('handoff model', () => {
  it('prefills each section from the draft and counts what was recorded', () => {
    const p = fromDraft(drafted, 'Unknown');
    expect(p.room).toBe('12');
    expect(p.entries).toBe(14);
    expect(p.lines.situation[0]).toMatchObject({ text: 'BP 148/92 · HR 104', source: 'vitals' });
    expect(p.stability).toBeUndefined();
  });

  it('starts empty for a patient whose content was not released', () => {
    const p = fromDraft({ ...drafted, content: 'not_permitted', sbar: null }, 'Unknown');
    expect(p.lines.situation).toEqual([]);
  });

  it('sends each section as text, recommendations as to-dos, and nothing nobody filled', () => {
    const p = fromDraft(drafted, 'Unknown');
    p.lines.recommendation.push({ key: 'x', text: 'Repeat BP at 20:00' }, { key: 'y', text: '   ' });
    const payload = toPayload(p);
    expect(payload.sbar.situation).toBe('BP 148/92 · HR 104');
    expect(payload.sbar.assessment).toBe('');
    expect(payload.todos).toEqual(['HbA1c — lab order pending', 'Repeat BP at 20:00']);
    expect(payload).not.toHaveProperty('stability');
    expect(payload).not.toHaveProperty('lines');
    expect(toPayload({ ...p, stability: 'watch' }).stability).toBe('watch');
    expect(toPayload(blankPatient('P2', 'B'))).not.toHaveProperty('todos');
  });

  it('shows a patient to watch as such, then reviewed, then still to review', () => {
    const p = blankPatient('P1', 'A');
    expect(listStatus(p)).toBe('toReview');
    expect(listStatus({ ...p, reviewed: true })).toBe('reviewed');
    expect(listStatus({ ...p, reviewed: true, stability: 'stable' })).toBe('reviewed');
    expect(listStatus({ ...p, stability: 'unstable' })).toBe('unstable');
  });

  it('moves to the next selected patient still to review', () => {
    const list = ['A', 'B', 'C', 'D'].map((id) => blankPatient(id, id));
    list[1].reviewed = true;
    const selected = new Set(['A', 'B', 'C']);
    expect(nextToReview(list, selected, 'A')).toBe('C');
    // D is not being handed over; A is next round.
    expect(nextToReview(list, selected, 'C')).toBe('A');
    expect(nextToReview(list.map((p) => ({ ...p, reviewed: true })), selected, 'A')).toBeNull();
  });
});
