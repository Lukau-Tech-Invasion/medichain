/**
 * Request and response shapes for the endpoints that score clinically.
 *
 * These exist because the endpoint functions took `data: unknown`, which is how
 * four pages came to post payloads no handler read. `BurnPage` sent `total_bsa`
 * and `parkland_fluid` against a handler expecting `tbsa_percentage` and
 * `parkland_formula_volume`; `FallRiskPage` nested its Morse items under
 * `morse_scale` in camelCase against six flat snake_case keys; `CardiacPage`
 * sent `stemi` against an enum spelling `STEMI`; `PreOpPage` sent `II` against
 * an enum spelling `ASA2` — while the database column it feeds has always
 * accepted exactly `II`. Two of those failed loudly with a 400 and two
 * succeeded while discarding everything clinical. TypeScript could see none
 * of it.
 *
 * Every response here carries the values the **server** derived. That is the
 * point: the page displays what was stored, not what it calculated.
 */

/** The six Morse Fall Scale items, flat, under the API's own names. */
export interface CreateFallRiskRequest {
  patient_id: string;
  assessment_tool?: string;
  /** 0 or 25 */
  history_of_falling: number;
  /** 0 or 15 */
  secondary_diagnosis: number;
  /** 0, 15 or 30 */
  ambulatory_aid: number;
  /** 0 or 20 */
  iv_therapy: number;
  /** 0, 10 or 20 */
  gait_status: number;
  /** 0 or 15 */
  mental_status: number;
  interventions?: string[];
  additional_factors?: string[];
  environmental_hazards?: string[];
  medications?: string[];
  recent_fall?: boolean;
  mobility?: string;
  notes?: string;
  assessed_at?: string;
  /**
   * Deliberately absent: `total_score` and `risk_level`. The server sums the
   * six items and bands the total, and in PostgreSQL both are generated
   * columns — a client cannot set them, so accepting them here would only let
   * a page believe it had.
   */
}

export interface FallRiskCreateResult {
  id: string;
  success: boolean;
  /** As scored and stored by the server. */
  total_score: number;
  /** `low` | `moderate` | `high`, derived from `total_score`. */
  risk_level: string;
}

/** One charted region on the Lund-Browder burn diagram. */
export interface BurnAreaInput {
  /** Lund-Browder region id (`head`, `right_forearm`, ...). */
  regionId: string;
  /**
   * How much of **this region** is burned, 0-100 — not a share of the whole
   * body. The server applies the region's size at the patient's age, so the
   * clinician never multiplies anything.
   */
  percent_of_region: number;
  depth?: string;
}

export interface CreateBurnRequest {
  patient_id: string;
  /** kg. Without it the server stores no Parkland volume rather than one
   *  computed from a default weight. */
  weight?: number;
  burn_areas: BurnAreaInput[];
  mechanism?: string;
  agent_source?: string;
  injury_time?: string;
  inhalation_injury?: {
    suspected: boolean;
    singedHairs?: boolean;
    sootInAirway?: boolean;
    hoarseness?: boolean;
    stridor?: boolean;
    carbonMonoxide?: boolean;
  };
  circumferential?: {
    present: boolean;
    locations?: string[];
    escharotomyNeeded?: boolean;
  };
  associated_injuries?: string[];
  interventions?: string[];
  tetanus_status?: string;
  pain_level?: number;
  fluid_start_time?: string;
  urine_output?: number;
  notes?: string;
  /**
   * Deliberately absent: `total_bsa` and `parkland_fluid`. Both are computed
   * by the server from `weight` and `burn_areas` — this is a fluid order for a
   * burned patient, and it has one author.
   */
}

/** The Parkland prescription as the server computed it. */
export interface ParklandFluid {
  total_24h_ml: number;
  first_8h_ml: number;
  next_16h_ml: number;
  hourly_first_8h_ml: number;
  hourly_next_16h_ml: number;
  urine_output_target_ml_hr: number;
}

export interface BurnCreateResult {
  success: boolean;
  assessment_id: string;
  total_bsa_percent: number;
  /** Which Lund-Browder column the body was charted against. */
  lund_browder_band: number;
  lund_browder_band_label: string;
  patient_age_years: number | null;
  severity: 'minor' | 'moderate' | 'major';
  /** `null` when no weight was supplied: no weight, no fluid order. */
  parkland_fluid: ParklandFluid | null;
  transfer_to_burn_center: boolean;
}

/**
 * The five TIMI criteria that are clinical judgements.
 *
 * Age and the cardiac marker are not here: the server reads age from the
 * patient's date of birth and derives the marker from the troponin value in
 * the same submission, against the published assay threshold.
 */
export interface TimiCriteriaInput {
  three_or_more_cad_risk_factors: boolean;
  known_cad: boolean;
  aspirin_in_past_7_days: boolean;
  severe_angina: boolean;
  st_deviation: boolean;
}

export interface CreateCardiacRequest {
  patient_id: string;
  event_type: string;
  chief_complaint?: string;
  symptom_onset?: string;
  chest_pain_character?: string;
  pain_radiation?: string[];
  associated_symptoms?: string[];
  vital_signs?: Record<string, unknown>;
  lab_values?: Record<string, unknown>;
  killip_class?: number;
  timi_criteria: TimiCriteriaInput;
  ecg_readings?: unknown[];
  treatments?: string[];
  disposition?: string;
  narrative?: string;
  timeline?: unknown[];
  cath_lab_activated?: boolean;
  pci_performed?: boolean;
  door_to_balloon_minutes?: number;
}

export interface CardiacCreateResult {
  id: string;
  success: boolean;
  /** 0–7, as scored by the server. */
  timi_score: number;
  /** `low` | `intermediate` | `high`. */
  timi_band: string;
  /** The normalised event type actually stored. */
  event_type: string;
}

/** START observations for one casualty. `ambulatory` is START's first question. */
export interface MciCasualtyVitals {
  ambulatory: boolean;
  respiratoryRate?: number;
  /** 0 means no palpable radial pulse. */
  pulse?: number;
  capRefill?: number;
  mentalStatus?: string;
}

export interface MciCasualtyInput {
  tagNumber: string;
  patient_id?: string;
  age?: string;
  gender?: string;
  chiefComplaint?: string;
  injuries?: string[];
  vitals: MciCasualtyVitals;
  location?: string;
  destination?: string;
  triageTime?: string;
  notes?: string;
  /** A responder's override of the computed category. Both are stored. */
  category?: string;
}

export interface CreateMciRequest {
  incident: {
    incidentName: string;
    incidentType: string;
    location: string;
    startTime?: string;
    commandPost?: string;
    incidentCommander?: string;
    contactNumber?: string;
    estimatedCasualties?: number;
    resourcesRequested?: string[];
  };
  patients: MciCasualtyInput[];
}

export interface MciCreateResult {
  success: boolean;
  incident_id: string;
  /** One row is written per casualty; this is how many landed. */
  casualties_stored: number;
  triage: Array<{
    tag_number: string;
    start_triage_computed: string;
    triage_category: string;
    colour: string;
  }>;
  category_counts: Record<string, number>;
}

export interface IvSiteCreateResult {
  success: boolean;
  sites: Array<{
    id: string;
    site_id: string;
    /** VIP stage as scored by the server, or `null` if the site was not assessed. */
    phlebitis_score: number | null;
    /** What that stage requires — `observe`, `resite_cannula`, … */
    action: string | null;
    /** Hours before this device is due for review, or `null` if it has no clock. */
    dwell_limit_hours: number | null;
  }>;
}

export interface PreOpCreateResult {
  id: string;
  success: boolean;
  /** `I`…`VI`, with a `-E` suffix for an emergency case (never on `VI`). */
  asa_classification: string | null;
  cleared_for_surgery: boolean;
}

/** One affected relative, for one condition category. */
export interface AffectedRelativeInput {
  relationship: string;
  age_of_onset?: number;
}

export interface AssessFamilyHistoryRequest {
  groups: Array<{
    /** Echoed back so the caller can match the assessment to its panel. */
    category: string;
    relatives: AffectedRelativeInput[];
  }>;
}

/** What a family history suggests should happen next, as the server scored it. */
export interface FamilyHistoryAssessmentResult {
  category: string;
  score: number;
  /** `standard_care` | `enhanced_screening` | `genetics_referral`. */
  band: string;
  first_degree_affected: number;
  second_degree_affected: number;
  third_degree_affected: number;
  early_onset_affected: number;
  /** Relationships the scale does not recognise. Counted, never guessed at. */
  unscored_relatives: number;
}

export interface AssessFamilyHistoryResult {
  assessments: FamilyHistoryAssessmentResult[];
}

/** qSOFA as the server scored it. */
export interface QsofaResult {
  total: number;
  respiratory_rate_high: boolean | null;
  systolic_bp_low: boolean | null;
  altered_mentation: boolean | null;
  /** How many of the three observations were recorded. */
  criteria_measured: number;
  positive: boolean;
}

/**
 * SOFA as the server scored it.
 *
 * A system is `null` when nothing was recorded for it — deliberately not 0,
 * which means "this organ is working". `systems_measured` travels with the
 * total because 2 from six systems and 2 from one are different pictures.
 */
export interface SofaResult {
  total: number;
  respiration: number | null;
  coagulation: number | null;
  liver: number | null;
  cardiovascular: number | null;
  central_nervous_system: number | null;
  renal: number | null;
  systems_measured: number;
}

export interface SepsisCreateResult {
  id: string;
  success: boolean;
  qsofa: QsofaResult;
  sofa: SofaResult;
}
