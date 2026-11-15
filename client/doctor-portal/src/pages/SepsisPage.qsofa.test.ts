import { describe, expect, it } from 'vitest';
import { qsofaPreview, type ScoringCatalog } from '@medichain/shared';

// The same cases as `qsofa_scores_three_bedside_observations` in
// api/src/clinical_scoring.rs: the preview has to agree with what is stored.
const catalog = {
  qsofa: { respiratory_rate_at_or_above: 22, systolic_bp_at_or_below: 100, gcs_below: 15, positive_threshold: 2 },
} as ScoringCatalog;
const score = (respiratoryRate: number | null, systolicBP: number | null, gcs: number | null) =>
  qsofaPreview({ respiratoryRate, systolicBP, gcs }, catalog);

describe('qsofaPreview', () => {
  it('scores the three observations at the served cut-points', () => {
    expect(score(24, 90, 13)).toMatchObject({ total: 3, positive: true, criteria_measured: 3 });
    expect(score(16, 120, 15)).toMatchObject({ total: 0, positive: false, criteria_measured: 3 });
    expect(score(22, null, null)?.total).toBe(1);
    expect(score(21, null, null)?.total).toBe(0);
    expect(score(null, 100, null)?.total).toBe(1);
    expect(score(null, 101, null)?.total).toBe(0);
    expect(score(null, null, 14)?.total).toBe(1);
    expect(score(null, null, 15)?.total).toBe(0);
  });

  it('does not score an observation nobody made', () => {
    expect(score(null, null, null)).toEqual({
      total: 0, respiratory_rate_high: null, systolic_bp_low: null, altered_mentation: null,
      criteria_measured: 0, positive: false,
    });
    expect(score(24, 90, null)).toMatchObject({ total: 2, positive: true, criteria_measured: 2, altered_mentation: null });
  });

  it('a coma score outside 3 to 15 is not a reading', () => {
    expect(score(null, null, 2)).toMatchObject({ altered_mentation: null, criteria_measured: 0 });
    expect(score(null, null, 16)).toMatchObject({ altered_mentation: null, criteria_measured: 0 });
  });

  it('has no score without the catalog, or with one that lacks the section', () => {
    const observations = { respiratoryRate: 24, systolicBP: 90, gcs: 13 };
    expect(qsofaPreview(observations, null)).toBeNull();
    expect(qsofaPreview(observations, {} as ScoringCatalog)).toBeNull();
  });
});
