/**
 * Clinical scoring — the client half of `api/src/clinical_scoring.rs`.
 *
 * The rule this module exists to enforce: **a page never decides a clinical
 * value.** Six scales used to be implemented twice — once in Rust and once in
 * the TSX file that collected the inputs — and the browser's copy was the one
 * that got stored, because the handlers persisted whatever the client sent.
 * Three of the six had drifted:
 *
 * - `CardiacPage` scored TIMI's "3+ CAD risk factors" from a list containing
 *   diabetes *or* hypertension, and read "2+ anginal episodes in 24h" off a
 *   chest-pain *character* dropdown.
 * - `MCIPage` skipped START's first question — "can they walk" — with a comment
 *   saying it assumed every casualty was non-ambulatory.
 * - `FallRiskPage` posted its Morse items under keys the server did not read,
 *   so every assessment was stored as 0, which bands as low risk.
 *
 * What is here now is a **preview**, and nothing else. It exists because a nurse
 * ticking six boxes should see the total move, and a round trip per checkbox
 * would be worse than the duplication was. It reads its thresholds from
 * `GET /api/clinical/scoring/catalog`, so there is still exactly one place the
 * numbers live; without the catalog it returns `null` and the page shows a
 * dash, which is honest.
 *
 * The value that is *stored* always comes back in the create response. Show
 * that one once it arrives.
 */

import { getApiClient } from '../api/client';

/*
 * Every accessor below treats a missing *section* the same way it treats a
 * missing catalog: no value. A page that reads `catalog.timi.threshold` against
 * a catalog whose `timi` key did not arrive throws inside render, and a React
 * render that throws is a blank screen — on the burn page that is a blank
 * screen instead of a fluid order. The unit suite caught exactly this.
 */

/** A band in a scored scale: `max: null` means the band is open-ended. */
export interface ScoreBand {
  level: string;
  min: number;
  max: number | null;
}

/** One scale item and the values the scale permits for it. */
export interface ScaleItem {
  name: string;
  values: number[];
}

export interface ScoringCatalog {
  morse_fall_scale: {
    items: ScaleItem[];
    bands: ScoreBand[];
  };
  burn: {
    /** The Lund-Browder body chart, age-banded. */
    lund_browder: {
      /** Lower bound in whole years for each column. */
      age_bands: number[];
      age_band_labels: string[];
      regions: Array<{
        id: string;
        name: string;
        /** Percentage of total body surface, one per age band. */
        percent_by_age_band: number[];
      }>;
    };
    parkland_ml_per_kg_per_percent: number;
    urine_target_ml_kg_hr: number;
    first_block_fraction: number;
    first_block_hours: number;
    second_block_hours: number;
    severity: {
      major_tbsa_percent: number;
      moderate_tbsa_percent: number;
      major_regardless_of_tbsa: string[];
    };
  };
  timi: {
    criteria: string[];
    troponin_threshold_ng_ml: number;
    bands: ScoreBand[];
  };
  start_triage: {
    respiratory_rate_immediate_above: number;
    capillary_refill_immediate_above_secs: number;
    absent_radial_pulse_is_immediate: boolean;
    categories: string[];
  };
  vip_phlebitis: {
    signs: Array<{ name: string; stage: number }>;
    actions: Array<{ score: number; action: string }>;
  };
  catheter_dwell_hours: Record<string, number | null>;
  family_history: {
    first_degree: string[];
    second_degree: string[];
    third_degree: string[];
    points: { first_degree: number; second_degree: number; third_degree: number };
    early_onset_age_years: number;
    early_onset_multiplier: number;
    bands: ScoreBand[];
  };
  medication: {
    /** Minutes after the scheduled time before a dose counts as overdue. */
    overdue_after_minutes: number;
  };
  fluid_balance: {
    positive_high_ml: number;
    positive_ml: number;
    negative_ml: number;
    bands: Array<{ level: string; min_ml?: number; max_ml?: number }>;
  };
}

/**
 * Fetch the scoring catalog.
 *
 * Cacheable and patient-free: it describes protocol, not people.
 */
export async function getScoringCatalog(): Promise<ScoringCatalog> {
  return getApiClient().get<ScoringCatalog>('/api/clinical/scoring/catalog');
}

/**
 * The band a score falls in, from server-supplied bands.
 *
 * Returns `null` when the catalog has not loaded — the caller shows a dash
 * rather than guessing a band, because a guessed band on a falls assessment is
 * the difference between a bed alarm and no bed alarm.
 */
export function bandFor(score: number, bands: ScoreBand[] | undefined): string | null {
  if (!bands?.length) return null;
  for (const band of bands) {
    const underMax = band.max === null || score <= band.max;
    if (score >= band.min && underMax) return band.level;
  }
  return null;
}

/**
 * Sum the six Morse Fall Scale items for the live preview.
 *
 * Arithmetic on the page's own form state, not policy: the *bands* come from
 * the catalog and the stored total is recomputed server-side from the same six
 * numbers. Kept separate from `bandFor` so it is obvious which half is which.
 */
export function morseTotal(items: Record<string, number>): number {
  return Object.values(items).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
}

/** Preview of the Parkland volumes, using the catalog's constants. */
export interface ParklandPreview {
  total24hMl: number;
  first8hMl: number;
  next16hMl: number;
  hourlyFirst8hMl: number;
  hourlyNext16hMl: number;
  urineTargetMlHr: number;
}

/**
 * Parkland preview. `null` for any input that cannot produce a prescription —
 * no weight, no burn charted, or a catalog that has not loaded.
 *
 * The old in-page version defaulted the weight to 70 kg and always produced a
 * number, which for a burned child is a fluid order roughly three times too
 * large.
 */
export function parklandPreview(
  weightKg: number | undefined,
  tbsaPercent: number,
  catalog: ScoringCatalog | null,
): ParklandPreview | null {
  if (!catalog) return null;
  if (!weightKg || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isFinite(tbsaPercent) || tbsaPercent <= 0 || tbsaPercent > 100) return null;

  const burn = catalog.burn;
  if (!burn) return null;

  const total = burn.parkland_ml_per_kg_per_percent * weightKg * tbsaPercent;
  const first = total * burn.first_block_fraction;
  const second = total - first;
  return {
    total24hMl: Math.round(total),
    first8hMl: Math.round(first),
    next16hMl: Math.round(second),
    hourlyFirst8hMl: Math.round(first / burn.first_block_hours),
    hourlyNext16hMl: Math.round(second / burn.second_block_hours),
    urineTargetMlHr: weightKg * burn.urine_target_ml_kg_hr,
  };
}

/**
 * Whole years between a `YYYY-MM-DD` date of birth and now.
 *
 * Mirrors `clinical_scoring::years_since`, including the birthday check that
 * `CardiacPage`'s `thisYear - birthYear` was missing — a year out for anyone who
 * has not had their birthday, on a boundary that decides a Lund-Browder column.
 */
export function yearsSince(dateOfBirth: string, now: Date = new Date()): number | null {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 && years <= 130 ? years : null;
}

/**
 * The Lund-Browder column index for an age. `null` when there isn't one.
 *
 * Null is not a signal to fall back to the adult column. A burn charted on the
 * adult column puts an infant's head at 7% when it is 19%, and TBSA is what the
 * fluid order is computed from — the server refuses such a submission outright.
 */
export function lundBrowderBand(
  ageYears: number | null,
  catalog: ScoringCatalog | null,
): number | null {
  const bands = catalog?.burn?.lund_browder?.age_bands;
  if (!bands?.length || ageYears === null) return null;
  let band = 0;
  bands.forEach((lowerBound, index) => {
    if (ageYears >= lowerBound) band = index;
  });
  return band;
}

/** What percentage of the body one region is, at a given age band. */
export function lundBrowderRegionPercent(
  regionId: string,
  band: number | null,
  catalog: ScoringCatalog | null,
): number | null {
  if (band === null) return null;
  const region = catalog?.burn?.lund_browder?.regions?.find((r) => r.id === regionId);
  return region?.percent_by_age_band?.[band] ?? null;
}

/**
 * Preview TBSA from a charted body.
 *
 * `percentOfRegion` is how much of *that region* is burned, 0-100 — not a share
 * of the whole body. The region's size at the patient's age is applied here, so
 * the clinician never multiplies anything.
 */
export function lundBrowderTbsa(
  charted: Array<{ regionId: string; percentOfRegion: number }>,
  band: number | null,
  catalog: ScoringCatalog | null,
): number | null {
  if (band === null || !catalog?.burn?.lund_browder?.regions) return null;
  let total = 0;
  for (const { regionId, percentOfRegion } of charted) {
    const size = lundBrowderRegionPercent(regionId, band, catalog);
    if (size === null || !Number.isFinite(percentOfRegion)) continue;
    total += size * Math.min(Math.max(percentOfRegion, 0), 100) / 100;
  }
  return Math.min(Math.max(total, 0), 100);
}

/** Burn severity preview. `null` until the catalog loads. */
export function burnSeverityPreview(
  tbsaPercent: number,
  inhalation: boolean,
  circumferential: boolean,
  catalog: ScoringCatalog | null,
): 'minor' | 'moderate' | 'major' | null {
  if (!catalog) return null;
  const severity = catalog.burn?.severity;
  if (!severity) return null;
  const { major_tbsa_percent, moderate_tbsa_percent } = severity;
  if (tbsaPercent >= major_tbsa_percent || inhalation || circumferential) return 'major';
  if (tbsaPercent >= moderate_tbsa_percent) return 'moderate';
  return 'minor';
}

/** The VIP phlebitis stage for a set of site findings. `null` until loaded. */
export function vipScorePreview(
  conditions: string[],
  catalog: ScoringCatalog | null,
): number | null {
  if (!catalog) return null;
  const signs = catalog.vip_phlebitis?.signs;
  if (!signs) return null;
  let score = 0;
  for (const condition of conditions) {
    const sign = signs.find((s) => s.name === condition);
    if (sign && sign.stage > score) score = sign.stage;
  }
  return score;
}

/** What a VIP stage requires. `null` until the catalog loads. */
export function vipActionPreview(
  score: number | null,
  catalog: ScoringCatalog | null,
): string | null {
  if (!catalog || score === null) return null;
  return catalog.vip_phlebitis?.actions?.find((a) => a.score === score)?.action ?? null;
}

/**
 * When a device inserted at `insertedAt` is due for review.
 *
 * `null` when the catalog has not loaded or the device has no clock. The dwell
 * limits used to be a `switch` inside `IVSitePage`; they are ward policy, and
 * ward policy that lives in a component cannot be changed without a deploy.
 */
export function dwellDueAt(
  insertedAt: string,
  catheterType: string,
  catalog: ScoringCatalog | null,
): Date | null {
  if (!catalog) return null;
  const hours = catalog.catheter_dwell_hours?.[catheterType];
  if (hours == null) return null;
  const inserted = new Date(insertedAt);
  if (Number.isNaN(inserted.getTime())) return null;
  return new Date(inserted.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Band a 24-hour fluid balance. `null` until the catalog loads.
 *
 * The boundaries were literals in `IntakeOutputPage` — `> 1000`, `> 500`,
 * `< -500`. They are ward policy: a patient running a litre positive is a
 * patient being fluid-overloaded, and the threshold at which that is called out
 * should not need a front-end deploy to change.
 */
export function fluidBalanceBand(
  balanceMl: number,
  catalog: ScoringCatalog | null,
): string | null {
  const fb = catalog?.fluid_balance;
  if (!fb) return null;
  if (balanceMl > fb.positive_high_ml) return 'positive_high';
  if (balanceMl > fb.positive_ml) return 'positive';
  if (balanceMl < fb.negative_ml) return 'negative';
  return 'balanced';
}

/**
 * Whether a dose scheduled at `scheduledAt` is now overdue.
 *
 * `null` until the catalog loads — the caller shows the dose as pending rather
 * than guessing, because "overdue" is what turns it red and puts it in front of
 * the nurse.
 */
export function isDoseOverdue(
  scheduledAt: Date,
  catalog: ScoringCatalog | null,
  now: Date = new Date(),
): boolean | null {
  const minutes = catalog?.medication?.overdue_after_minutes;
  if (minutes == null) return null;
  return now.getTime() > scheduledAt.getTime() + minutes * 60_000;
}

/*
 * There is deliberately no `familyHistoryAssessment` here.
 *
 * It existed briefly, mirroring the Rust, and was deleted once
 * `POST /api/clinical/family-history/assess` landed: family history is the one
 * scale with no stored value, so there was no create response to carry the
 * answer and a client-side copy looked like the only option. A small stateless
 * endpoint is the better one, because it leaves
 * `clinical_scoring::family_history_assessment` as the single implementation.
 *
 * The catalog still publishes the degree lists, the early-onset age and the
 * band thresholds under `family_history` — that is a description of what the
 * server will do, not a second place it is done.
 */
