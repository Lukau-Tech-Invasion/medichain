import { describe, expect, it } from 'vitest';
import { airwayDifficultyPreview, type ScoringCatalog } from '@medichain/shared';

// What the catalog serves (api/src/clinical_scoring.rs, `airway`). The page
// used to score this itself, from a form that opened on an easy airway.
const catalog = {
  airway: {
    mouth_opening_min_fingers: 3, thyromental_min_cm: 6, difficult_at_or_above: 3, criteria: 5,
    mallampati_points: { I: 0, II: 0, III: 1, IV: 2 },
  },
} as unknown as ScoringCatalog;

const unexamined = { mallampati: '', mouthOpening: null, thyromental: null, neckMobility: '', obeseNeck: null };

describe('airway difficulty preview', () => {
  it('has no score for an airway nobody examined, never 0', () => {
    expect(airwayDifficultyPreview(unexamined, catalog)).toEqual(
      { score: null, criteria_measured: 0, predicted_difficult: null });
  });

  it('predicts a difficult airway from the findings that reach the threshold', () => {
    expect(airwayDifficultyPreview({ ...unexamined, mallampati: 'IV', neckMobility: 'limited' }, catalog))
      .toEqual({ score: 3, criteria_measured: 2, predicted_difficult: true });
  });

  it('calls an airway not difficult only when every finding was examined', () => {
    const partial = airwayDifficultyPreview({ ...unexamined, mallampati: 'I' }, catalog);
    expect(partial?.predicted_difficult).toBeNull();
    const full = airwayDifficultyPreview(
      { mallampati: 'I', mouthOpening: 4, thyromental: 6.5, neckMobility: 'full', obeseNeck: false }, catalog);
    expect(full).toEqual({ score: 0, criteria_measured: 5, predicted_difficult: false });
  });

  it('waits for the catalog', () => {
    expect(airwayDifficultyPreview(unexamined, null)).toBeNull();
  });
});
