import { describe, expect, it } from 'vitest';
import type { HandoffDraftPatient } from '@medichain/shared';
import { createTranslator } from '../../../../shared/src/i18n';
import enUS from '../../../../shared/src/i18n/locales/en-US';
import { blankPatient, fromDraft, lineWriter, listStatus, nextToReview, toPayload } from './handoffModel';

const drafted: HandoffDraftPatient = {
  patient_id: 'P1',
  full_name: 'Thandiwe Nkosi',
  date_of_birth: '1992-03-12',
  bed_label: '12',
  recorded: [{ resource_type: 'vital_signs', count: 9, last_at: null }, { resource_type: 'mar', count: 5, last_at: null }],
  content: 'included',
  sbar: {
    situation: [{ text: 'BP 148/92 · HR 104', code: 'vitals', values: { readings: 'BP 148/92 · HR 104' }, source: 'vitals', at: '2026-11-08T14:00:00Z' }],
    background: [{ text: 'Allergies: Penicillin', code: 'allergies', values: { list: 'Penicillin' }, source: 'chart', at: null }],
    assessment: [],
    recommendation: [{ text: 'HbA1c — lab order pending', code: 'order_pending', values: { order: 'HbA1c', type: 'lab' }, source: 'order', at: '2026-11-08T07:15:00Z' }],
  },
};

describe('drafted line wording', () => {
  const english = lineWriter(createTranslator(enUS));
  const line = (code: string, values: Record<string, string>, text: string) =>
    ({ code, values, text, source: 'mar' as const, at: null });

  it('words every line exactly as the server does in English', () => {
    expect(english(line('dose_held', { medicine: 'Metformin', reason: 'Nil by mouth' }, ''))).toBe('Held Metformin: Nil by mouth');
    expect(english(line('dose_given', { medicine: 'Heparin', detail: '' }, ''))).toBe('Given Heparin');
    expect(english(line('fluid_balance', { intake: '1000', output: '1200', balance: '-200' }, '')))
      .toBe('In 1000 mL · Out 1200 mL · balance -200 mL');
    expect(english(line('order_on_hold', { order: 'HbA1c', type: 'lab' }, ''))).toBe('HbA1c — lab order pending (on hold)');
  });

  it("uses the ward's wording, filled with what was recorded and not translated", () => {
    const swahili = lineWriter(createTranslator({ docShiftHandoff: { line: { dose_held: 'Imesitishwa {{medicine}}: {{reason}}' } } }));
    expect(swahili(line('dose_held', { medicine: 'Metformin', reason: 'Nil by mouth' }, 'Held Metformin: Nil by mouth')))
      .toBe('Imesitishwa Metformin: Nil by mouth');
  });

  it("falls back to the server's English for a code it cannot word", () => {
    expect(english(line('something_new', {}, 'Server text'))).toBe('Server text');
    expect(english(line('dose_held', { medicine: 'Metformin' }, 'Held Metformin: NBM'))).toBe('Held Metformin: NBM');
  });
});

describe('handoff model', () => {
  it('prefills each section from the draft and counts what was recorded', () => {
    const p = fromDraft(drafted, 'Unknown');
    expect(p.room).toBe('12');
    expect(p.entries).toBe(14);
    expect(p.lines.situation[0]).toMatchObject({ text: 'BP 148/92 · HR 104', source: 'vitals' });
    expect(p.stability).toBeUndefined();
  });

  it('keeps a discharge that happened this shift, and nothing for a patient still in a bed', () => {
    expect(fromDraft({ ...drafted, discharged_at: '2026-11-14T11:20:00Z' }, 'Unknown').dischargedAt)
      .toBe('2026-11-14T11:20:00Z');
    expect(fromDraft(drafted, 'Unknown').dischargedAt).toBeUndefined();
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
