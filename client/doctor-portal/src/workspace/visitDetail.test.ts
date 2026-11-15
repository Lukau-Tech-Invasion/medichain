import { describe, expect, it } from 'vitest';
import { describeSave, excerpt } from './visitDetail';

const t = (key: string, vars?: Record<string, string | number>) =>
  key === 'workspace.visitNews2' ? `NEWS2 ${vars?.score} · ${vars?.band}` : key.split('.').pop()!;

describe('describeSave', () => {
  it('names a prescription by drug, strength and directions', () => {
    expect(describeSave('/api/e-prescriptions', { medication_name: 'Metformin', strength: '500 mg', directions: 'twice daily' }, {}, t))
      .toBe('Metformin 500 mg twice daily');
  });

  it('gives NEWS2 only as the server scored it, and nothing when it scored nothing', () => {
    expect(describeSave('/api/clinical/vitals', { heart_rate: 104 }, { news2: { total: 1, band: 'low' } }, t)).toBe('NEWS2 1 · low');
    // Unmeasured is not zero (rule 12): no line at all.
    expect(describeSave('/api/clinical/vitals', { heart_rate: 104 }, { news2: { total: null, band: null } }, t)).toBeUndefined();
  });

  it('uses the order text and the chief complaint', () => {
    expect(describeSave('/api/clinical/order', { order_text: 'HbA1c, lipid panel' }, {}, t)).toBe('HbA1c, lipid panel');
    expect(describeSave('/api/clinical/soap', { subjective: { chief_complaint: 'Chest tightness' } }, {}, t)).toBe('Chest tightness');
  });

  it('says nothing about a form it does not know, rather than guess', () => {
    expect(describeSave('/api/clinical/burn', { tbsa: 12 }, {}, t)).toBeUndefined();
    expect(describeSave('/api/clinical/order', {}, {}, t)).toBeUndefined();
  });

  it('keeps one short line', () => {
    expect(excerpt('\n  First line\nsecond')).toBe('First line');
    expect(excerpt('x'.repeat(200))).toHaveLength(80);
  });
});
