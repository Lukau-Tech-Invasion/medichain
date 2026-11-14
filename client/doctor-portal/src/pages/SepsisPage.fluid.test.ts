import { describe, expect, it } from 'vitest';
import { lactateBand, sepsisFluidTargetPreview, type ScoringCatalog } from '@medichain/shared';
import { emptySepsisForm, toSepsisRequest } from './SepsisPage.form';

// What the catalog serves (api/src/clinical_scoring.rs). The page used to show
// 70 kg x 30 = 2,100 mL for every patient and band lactate on literals.
const catalog = {
  sepsis: { fluid_ml_per_kg: 30, lactate_caution_at_or_above: 2, lactate_critical_at_or_above: 4 },
} as unknown as ScoringCatalog;

describe('sepsis fluid target', () => {
  it("follows the patient's weight, not an average 70 kg", () => {
    expect(sepsisFluidTargetPreview(45, catalog)).toBe(1350);
    expect(sepsisFluidTargetPreview(110, catalog)).toBe(3300);
  });

  it('is absent without a weight or before the catalog loads', () => {
    expect(sepsisFluidTargetPreview(null, catalog)).toBeNull();
    expect(sepsisFluidTargetPreview(0, catalog)).toBeNull();
    expect(sepsisFluidTargetPreview(70, null)).toBeNull();
  });

  it('sends the weight it was computed from, and nothing when none was entered', () => {
    const filing = { patientId: 'PAT-1', protocolStartTime: undefined, elapsedMinutes: 0 };
    expect(toSepsisRequest({ ...emptySepsisForm(), weightKg: '62.5' }, filing).weight_kg).toBe(62.5);
    expect(toSepsisRequest(emptySepsisForm(), filing).weight_kg).toBeUndefined();
  });
});

describe('lactate bands', () => {
  it('use the catalog cut-points', () => {
    expect(lactateBand(1.9, catalog)).toBe('normal');
    expect(lactateBand(2, catalog)).toBe('caution');
    expect(lactateBand(4, catalog)).toBe('critical');
  });

  it('are absent until the catalog loads', () => {
    expect(lactateBand(5, null)).toBeNull();
  });
});
