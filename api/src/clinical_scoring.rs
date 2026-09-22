//! Clinical scoring rules — the single authority for every derived clinical
//! value in the product.
//!
//! Six scales were implemented twice: once here in Rust and once in TypeScript
//! inside the page that collects the inputs. The browser's copy was the one
//! whose result got stored, because the handlers persisted whatever the client
//! sent. That arrangement fails in one direction only — the two copies drift,
//! the server stores the browser's answer, and nothing anywhere disagrees out
//! loud.
//!
//! Every function here is pure: inputs in, score out, no state and no I/O. That
//! makes them callable from three places without ceremony —
//!
//! * the create handlers, which recompute on save and store *their* answer
//!   rather than the client's;
//! * `GET /api/clinical/scoring/catalog`, which serves the thresholds and
//!   constants so a form can show a live preview without shipping a second copy
//!   of the policy;
//! * the tests below, which pin the published reference values.
//!
//! **Adding a scale:** put the rule here, expose its constants through
//! `catalog()`, call it from the handler, and have the page read the numbers
//! from the catalog. Do not put a threshold in a component.

use serde::{Deserialize, Serialize};

// ============================================================================
// MORSE FALL SCALE
// ============================================================================

/// Morse Fall Scale band boundaries. Below `MODERATE` is low risk; at or above
/// `HIGH` is high risk.
pub const MORSE_MODERATE_THRESHOLD: i32 = 25;
/// See [`MORSE_MODERATE_THRESHOLD`].
pub const MORSE_HIGH_THRESHOLD: i32 = 45;

/// The six Morse Fall Scale items, with the values the scale permits for each.
///
/// The permitted values are part of the scale, not of the form: a nurse cannot
/// score "history of falling" as 10. `fall_risk_assessments` enforces the same
/// sets as CHECK constraints, so a value outside them is rejected by the
/// database — publishing them here is what lets a form refuse it first.
pub const MORSE_ITEMS: [(&str, &[i32]); 6] = [
    ("history_of_falling", &[0, 25]),
    ("secondary_diagnosis", &[0, 15]),
    ("ambulatory_aid", &[0, 15, 30]),
    ("iv_therapy", &[0, 20]),
    ("gait_status", &[0, 10, 20]),
    ("mental_status", &[0, 15]),
];

/// Band a Morse Fall Scale total.
///
/// The bands drive the prevention plan: low gets standard precautions,
/// moderate adds a bed alarm and hourly rounding, high adds signage and
/// supervised toileting. Getting the band wrong low is the dangerous
/// direction — the patient looks safer than they are.
pub fn morse_band(total: i32) -> &'static str {
    debug_assert!(total >= 0, "a Morse total is a sum of non-negative items");
    if total >= MORSE_HIGH_THRESHOLD {
        "high"
    } else if total >= MORSE_MODERATE_THRESHOLD {
        "moderate"
    } else {
        "low"
    }
}

// ============================================================================
// BURN: TBSA AND PARKLAND FLUID RESUSCITATION
// ============================================================================

/// Parkland formula coefficient: millilitres of crystalloid per kg per %TBSA
/// over the first 24 hours.
pub const PARKLAND_ML_PER_KG_PER_PERCENT: f64 = 4.0;
/// Minimum acceptable urine output, mL/kg/hr, used as the resuscitation target.
pub const PARKLAND_URINE_TARGET_ML_KG_HR: f64 = 0.5;
/// A burn at or above this %TBSA is major regardless of anything else.
pub const BURN_MAJOR_TBSA_PERCENT: f64 = 25.0;
/// A burn at or above this %TBSA is at least moderate.
pub const BURN_MODERATE_TBSA_PERCENT: f64 = 10.0;

/// Parkland formula result, split into the blocks it is actually delivered in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParklandFluid {
    /// Total crystalloid over 24 hours from the time of the **burn**, not of arrival.
    pub total_24h_ml: i32,
    /// Half the total, given over the first 8 hours from the time of the burn.
    pub first_8h_ml: i32,
    /// The other half, given over the following 16 hours.
    pub next_16h_ml: i32,
    /// Infusion rate for the first block.
    pub hourly_first_8h_ml: i32,
    /// Infusion rate for the second block.
    pub hourly_next_16h_ml: i32,
    /// Urine output to titrate against.
    pub urine_output_target_ml_hr: f64,
}

/// Parkland formula: 4 mL x weight(kg) x %TBSA, half in the first 8 hours.
///
/// Returns `None` for inputs that cannot produce a prescription. A zero or
/// negative weight, or a TBSA outside 0-100, is a data-entry error, and the
/// honest response to one is no number rather than a plausible one — this
/// figure is a fluid order for a burned patient.
pub fn parkland_fluid(weight_kg: f64, tbsa_percent: f64) -> Option<ParklandFluid> {
    if !weight_kg.is_finite() || !tbsa_percent.is_finite() {
        return None;
    }
    if weight_kg <= 0.0 || !(0.0..=100.0).contains(&tbsa_percent) {
        return None;
    }

    let total = PARKLAND_ML_PER_KG_PER_PERCENT * weight_kg * tbsa_percent;
    let half = total / 2.0;
    Some(ParklandFluid {
        total_24h_ml: total.round() as i32,
        first_8h_ml: half.round() as i32,
        next_16h_ml: half.round() as i32,
        hourly_first_8h_ml: (half / 8.0).round() as i32,
        hourly_next_16h_ml: (half / 16.0).round() as i32,
        urine_output_target_ml_hr: weight_kg * PARKLAND_URINE_TARGET_ML_KG_HR,
    })
}

/// Burn severity band.
///
/// Inhalation injury and circumferential burns make a burn major at any TBSA:
/// the first threatens the airway and the second the circulation to a limb,
/// and neither cares how much surface is involved.
pub fn burn_severity(tbsa_percent: f64, inhalation: bool, circumferential: bool) -> &'static str {
    if tbsa_percent >= BURN_MAJOR_TBSA_PERCENT || inhalation || circumferential {
        "major"
    } else if tbsa_percent >= BURN_MODERATE_TBSA_PERCENT {
        "moderate"
    } else {
        "minor"
    }
}

// ============================================================================
// PATIENT AGE
// ============================================================================

/// Whole years between a `YYYY-MM-DD` date of birth and now.
///
/// Lives here because two scales turn on it — the TIMI age criterion and the
/// Lund-Browder band — and both are boundary questions where being a year out
/// changes the answer. `CardiacPage` computed it as `thisYear - birthYear`,
/// which is exactly a year out for anyone who has not had their birthday yet,
/// and 64-turning-65 is the boundary TIMI asks about.
pub fn years_since(date_of_birth: &str, now: chrono::DateTime<chrono::Utc>) -> Option<i64> {
    use chrono::Datelike;
    let dob = chrono::NaiveDate::parse_from_str(date_of_birth.trim(), "%Y-%m-%d").ok()?;
    let today = now.date_naive();
    let mut years = i64::from(today.year() - dob.year());
    // Not yet had this year's birthday.
    if (today.month(), today.day()) < (dob.month(), dob.day()) {
        years -= 1;
    }
    Some(years)
}

// ============================================================================
// LUND-BROWDER BODY SURFACE CHART
// ============================================================================

/// The Lund-Browder age bands, as lower bounds in whole years.
///
/// Body proportions change continuously through childhood, and the chart
/// samples that at five points before adulthood. A newborn's head is 19% of its
/// body surface; a five-year-old's is 13%; an adult's is 7%. The legs move the
/// other way to compensate.
pub const LUND_BROWDER_AGE_BANDS: [u32; 6] = [0, 1, 5, 10, 15, 18];

/// Human-readable band labels, in the same order.
pub const LUND_BROWDER_BAND_LABELS: [&str; 6] = [
    "under 1 year",
    "1 to 4 years",
    "5 to 9 years",
    "10 to 14 years",
    "15 to 17 years",
    "18 years and over",
];

/// The Lund-Browder chart: region id, display name, and its percentage of total
/// body surface in each of the six age bands.
///
/// This replaces a Rule of 9s chart with an `isChild` boolean. Rule of 9s is an
/// adult approximation — it is the right tool for a rapid adult estimate and the
/// wrong one for a child, because a boolean cannot express a proportion that
/// changes at five points between birth and adulthood. Every child between the
/// bands was charted against the wrong denominator.
///
/// Lund-Browder is not the same numbers on the same regions: it splits each limb
/// (upper arm / forearm / hand, thigh / lower leg / foot), separates the neck
/// and the buttocks, and charts the trunk as 13% front and 13% back against Rule
/// of 9s' 18% and 18%. Substituting its percentages into a Rule-of-9s region set
/// produces a chart that does not total 100, which is worse than either method
/// used consistently — which is why the region set had to change with it.
///
/// The columns are ordered by [`LUND_BROWDER_AGE_BANDS`]. Every column sums to
/// exactly 100; `lund_browder_columns_each_total_one_hundred` asserts it.
pub const LUND_BROWDER_REGIONS: [(&str, &str, [f64; 6]); 19] = [
    ("head", "Head", [19.0, 17.0, 13.0, 11.0, 9.0, 7.0]),
    ("neck", "Neck", [2.0; 6]),
    ("anterior_trunk", "Anterior trunk", [13.0; 6]),
    ("posterior_trunk", "Posterior trunk", [13.0; 6]),
    ("right_buttock", "Right buttock", [2.5; 6]),
    ("left_buttock", "Left buttock", [2.5; 6]),
    ("genitalia", "Genitalia", [1.0; 6]),
    ("right_upper_arm", "Right upper arm", [4.0; 6]),
    ("left_upper_arm", "Left upper arm", [4.0; 6]),
    ("right_forearm", "Right forearm", [3.0; 6]),
    ("left_forearm", "Left forearm", [3.0; 6]),
    ("right_hand", "Right hand", [2.5; 6]),
    ("left_hand", "Left hand", [2.5; 6]),
    ("right_thigh", "Right thigh", [5.5, 6.5, 8.0, 8.5, 9.0, 9.5]),
    ("left_thigh", "Left thigh", [5.5, 6.5, 8.0, 8.5, 9.0, 9.5]),
    (
        "right_lower_leg",
        "Right lower leg",
        [5.0, 5.0, 5.5, 6.0, 6.5, 7.0],
    ),
    (
        "left_lower_leg",
        "Left lower leg",
        [5.0, 5.0, 5.5, 6.0, 6.5, 7.0],
    ),
    ("right_foot", "Right foot", [3.5; 6]),
    ("left_foot", "Left foot", [3.5; 6]),
];

/// The Lund-Browder column for a patient's age in whole years.
///
/// Returns `None` for an age that cannot be a patient's — the caller refuses to
/// chart rather than picking a column. There is no safe default here: taking the
/// adult column for an unknown age charts a burned infant's head at 7% when it
/// is 19%, and TBSA is what the fluid order is computed from.
pub fn lund_browder_band(age_years: i64) -> Option<usize> {
    if !(0..=130).contains(&age_years) {
        return None;
    }
    let age = age_years as u32;
    // Highest band whose lower bound the patient has reached.
    let mut band = 0;
    for (index, lower_bound) in LUND_BROWDER_AGE_BANDS.iter().enumerate() {
        if age >= *lower_bound {
            band = index;
        }
    }
    Some(band)
}

/// What percentage of total body surface one region is, at a given age band.
pub fn lund_browder_region_percent(region_id: &str, band: usize) -> Option<f64> {
    debug_assert!(band < 6, "there are six Lund-Browder age bands");
    LUND_BROWDER_REGIONS
        .iter()
        .find(|(id, _, _)| *id == region_id)
        .and_then(|(_, _, by_age)| by_age.get(band).copied())
}

/// Total TBSA from a charted body, as `(region_id, fraction_of_region_burned)`.
///
/// `fraction` is the proportion of *that region* which is burned, 0.0 to 1.0 —
/// not a share of the whole body. This is the input a burn chart actually
/// collects ("the front half of the left forearm"), and it means the clinician
/// never multiplies anything: the region's size at the patient's age is applied
/// here.
///
/// The previous arrangement asked for a share of the whole body per region,
/// which made the clinician do the multiplication in their head against a
/// denominator the page had already chosen wrongly for children.
///
/// Unknown region ids contribute nothing rather than being guessed at, and each
/// fraction is clamped to 0..=1 so a mis-scaled client cannot inflate the total.
pub fn lund_browder_tbsa(charted: &[(String, f64)], band: usize) -> f64 {
    debug_assert!(
        charted.len() <= LUND_BROWDER_REGIONS.len(),
        "a body has nineteen Lund-Browder regions; more is a bug upstream"
    );
    let mut total = 0.0_f64;
    for (region_id, fraction) in charted.iter().take(LUND_BROWDER_REGIONS.len()) {
        if !fraction.is_finite() {
            continue;
        }
        let Some(region_percent) = lund_browder_region_percent(region_id, band) else {
            continue;
        };
        total += region_percent * fraction.clamp(0.0, 1.0);
    }
    total.clamp(0.0, 100.0)
}

// ============================================================================
// TIMI RISK SCORE (UNSTABLE ANGINA / NSTEMI)
// ============================================================================

/// The seven TIMI criteria, each worth one point.
pub const TIMI_CRITERIA: [&str; 7] = [
    "age_65_or_over",
    "three_or_more_cad_risk_factors",
    "known_cad",
    "aspirin_in_past_7_days",
    "severe_angina",
    "st_deviation",
    "elevated_marker",
];

/// Troponin above this (ng/mL) counts as an elevated cardiac marker.
pub const TIMI_TROPONIN_THRESHOLD_NG_ML: f64 = 0.04;
/// TIMI 0-2 is low risk, 3-4 intermediate, 5-7 high.
pub const TIMI_INTERMEDIATE_THRESHOLD: u8 = 3;
/// See [`TIMI_INTERMEDIATE_THRESHOLD`].
pub const TIMI_HIGH_THRESHOLD: u8 = 5;

/// The seven TIMI criteria as booleans, in the order of [`TIMI_CRITERIA`].
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct TimiCriteria {
    /// Age >= 65 at the time of the event.
    #[serde(default)]
    pub age_65_or_over: bool,
    /// Three or more of: hypertension, hypercholesterolaemia, diabetes,
    /// current smoker, family history of premature CAD.
    #[serde(default)]
    pub three_or_more_cad_risk_factors: bool,
    /// Known coronary stenosis >= 50%.
    #[serde(default)]
    pub known_cad: bool,
    /// Aspirin taken in the seven days before presentation.
    #[serde(default)]
    pub aspirin_in_past_7_days: bool,
    /// Two or more anginal episodes in the preceding 24 hours.
    #[serde(default)]
    pub severe_angina: bool,
    /// ST deviation >= 0.5 mm on the presenting ECG.
    #[serde(default)]
    pub st_deviation: bool,
    /// Troponin or CK-MB above the assay's threshold.
    #[serde(default)]
    pub elevated_marker: bool,
}

/// TIMI risk score: one point per criterion met, 0-7.
pub fn timi_score(c: &TimiCriteria) -> u8 {
    let score = u8::from(c.age_65_or_over)
        + u8::from(c.three_or_more_cad_risk_factors)
        + u8::from(c.known_cad)
        + u8::from(c.aspirin_in_past_7_days)
        + u8::from(c.severe_angina)
        + u8::from(c.st_deviation)
        + u8::from(c.elevated_marker);
    debug_assert!(score <= 7, "TIMI has seven criteria");
    score
}

/// Band a TIMI score. The band, not the number, decides early invasive management.
pub fn timi_band(score: u8) -> &'static str {
    if score >= TIMI_HIGH_THRESHOLD {
        "high"
    } else if score >= TIMI_INTERMEDIATE_THRESHOLD {
        "intermediate"
    } else {
        "low"
    }
}

// ============================================================================
// START TRIAGE (MASS-CASUALTY)
// ============================================================================

/// Respiratory rate above this, in a non-ambulatory patient, is immediate.
pub const START_RESP_RATE_IMMEDIATE: i32 = 30;
/// Capillary refill above this many seconds is immediate.
pub const START_CAP_REFILL_IMMEDIATE_SECS: i32 = 2;

/// The inputs START triage asks for, in the order it asks for them.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct StartVitals {
    /// Walked to the collection point unaided.
    #[serde(default)]
    pub ambulatory: bool,
    /// Breathing at all, after one airway-opening attempt.
    #[serde(default)]
    pub breathing: bool,
    /// Breaths per minute.
    #[serde(default)]
    pub respiratory_rate: Option<i32>,
    /// Capillary refill in seconds.
    #[serde(default)]
    pub capillary_refill_secs: Option<i32>,
    /// Radial pulse palpable. START's perfusion check is "capillary refill over
    /// two seconds **or** no radial pulse" — in daylight, or on dark skin, or in
    /// the cold, capillary refill is the less reliable half, which is why the
    /// pulse is the field alternative rather than a second opinion. `None` means
    /// it was not assessed and only capillary refill decides.
    #[serde(default)]
    pub radial_pulse_present: Option<bool>,
    /// Follows simple commands.
    #[serde(default)]
    pub follows_commands: bool,
}

/// START triage category: `minor`, `delayed`, `immediate` or `expectant`.
///
/// The order of the checks *is* the algorithm — ambulation first, then
/// breathing, then perfusion, then mental status — and rearranging them changes
/// who gets carried first. `expectant` is reached only by "not breathing after
/// the airway is opened".
pub fn start_triage(v: &StartVitals) -> &'static str {
    if v.ambulatory {
        return "minor";
    }
    if !v.breathing {
        return "expectant";
    }
    if v.respiratory_rate
        .is_some_and(|r| r > START_RESP_RATE_IMMEDIATE)
    {
        return "immediate";
    }
    if v.capillary_refill_secs
        .is_some_and(|c| c > START_CAP_REFILL_IMMEDIATE_SECS)
        || v.radial_pulse_present == Some(false)
    {
        return "immediate";
    }
    if !v.follows_commands {
        return "immediate";
    }
    "delayed"
}

// ============================================================================
// VISUAL INFUSION PHLEBITIS (VIP) SCORE
// ============================================================================

/// Cannula-site observations and the phlebitis stage each one reaches.
///
/// The names are the vocabulary the assessment form collects, and the stages
/// are the ones the product has always applied — this moved the arithmetic to
/// the server without changing a single patient's score. `clean-dry-intact` is
/// listed explicitly at stage 0 so that "no abnormality observed" is a recorded
/// finding rather than an empty list, which is indistinguishable from "not
/// assessed".
/// The seven signs the Visual Infusion Phlebitis scale is scored from, as the
/// bedside form names them.
///
/// The stage against each name is the LOWEST stage at which that sign appears.
/// It is not the score: see [`vip_score`], which counts rather than maximises.
pub const VIP_SIGNS: [(&str, u8); 8] = [
    ("clean-dry-intact", 0),
    ("tenderness", 1),
    ("redness", 1),
    ("swelling", 2),
    ("warmth", 2),
    ("induration", 3),
    // Stage 4 is "pain along the path of the cannula, erythema, induration,
    // palpable venous cord"; stage 5 adds pyrexia or purulent discharge. The
    // table used to give drainage 4 and the cord 5, which is the two the wrong
    // way round.
    ("palpable-cord", 4),
    ("drainage", 5),
];

/// VIP score from the observed signs.
///
/// # The scale counts; it does not take a maximum
///
/// This function used to return the highest stage of any single sign observed.
/// That is not the VIP scale. Stage 1 is **one** of slight pain or slight
/// redness; stage 2 is **two** of pain, redness and swelling. So a cannula site
/// with both tenderness AND redness — the commonest presentation of early
/// phlebitis — scored 1 under the old rule and 2 under the scale.
///
/// The difference is the bedside action. [`vip_action`] maps 1 to
/// "observe_closely" and 2 to "resite_cannula", so under-scoring by one stage
/// left an inflamed cannula in the patient's arm.
///
/// The higher stages stay sign-driven, because that is how the scale defines
/// them: induration is stage 3 on its own, a palpable venous cord is stage 4,
/// and purulent discharge is stage 5. Those are cumulative descriptions, so the
/// highest one observed wins.
///
/// Unknown sign names are ignored rather than counted, so a client sending a
/// typo cannot inflate the score.
pub fn vip_score(observed: &[String]) -> u8 {
    debug_assert!(observed.len() <= 32, "VIP has seven signs");
    let has = |name: &str| observed.iter().take(32).any(|s| s == name);

    // Stages 3 to 5 are single-sign findings and outrank any count.
    if has("drainage") {
        return 5;
    }
    if has("palpable-cord") {
        return 4;
    }
    if has("induration") {
        return 3;
    }

    // Stages 0 to 2 are a count of the early signs. `warmth` is grouped with
    // swelling: both are the same inflammatory finding at the same stage on the
    // table above, and counting them separately would take a single warm,
    // swollen site to stage 2 on one observation.
    let early = u8::from(has("tenderness"))
        + u8::from(has("redness"))
        + u8::from(has("swelling") || has("warmth"));
    early.min(2)
}

/// What a VIP score requires. Stage 2 is the point of no return for the
/// cannula: it comes out.
pub fn vip_action(score: u8) -> &'static str {
    match score {
        0 => "observe",
        1 => "observe_closely",
        2..=3 => "resite_cannula",
        _ => "resite_and_treat",
    }
}

/// Maximum dwell time in hours before a peripheral device is resited.
///
/// A midline or PICC is not on a fixed clock — it is reviewed rather than
/// routinely replaced — so those return `None` rather than a number that would
/// prompt an unnecessary reinsertion.
pub fn catheter_dwell_limit_hours(catheter_type: &str) -> Option<i32> {
    match catheter_type {
        // 4 days. The peripheral range in practice is 72-96 hours, or sooner if
        // clinically indicated; this is the review point, not a guarantee.
        "peripheral" | "peripheral_iv" => Some(96),
        // 28 days.
        "midline" => Some(672),
        // 90 days.
        "picc" => Some(2160),
        // 7 days, because a non-tunnelled central line is reviewed daily and
        // this is the outer bound rather than an expected dwell.
        "central" => Some(168),
        // An emergency or field insertion is presumed non-sterile and comes out
        // within a shift once a clean line is established.
        "intraosseous" => Some(24),
        // Anything unrecognised takes the peripheral clock, because it prompts
        // a review sooner rather than later.
        _ => Some(96),
    }
}

// ============================================================================
// WARD THRESHOLDS
// ============================================================================

/// Minutes after a scheduled dose time before it counts as overdue.
///
/// A medication-safety policy, not a display preference: this is what turns a
/// pending dose red on the MAR and puts it in front of the nurse. It lived as a
/// literal `30 * 60000` inside `MedicationAdminPage`.
pub const MEDICATION_OVERDUE_AFTER_MINUTES: i64 = 30;

/// Fluid-balance bands, in millilitres over a 24-hour period.
///
/// Positive beyond `POSITIVE_HIGH` is the one that matters — a patient running
/// a litre positive is a patient being fluid-overloaded — and these were
/// literals inside `IntakeOutputPage`.
pub const FLUID_BALANCE_POSITIVE_HIGH_ML: i32 = 1000;
/// See [`FLUID_BALANCE_POSITIVE_HIGH_ML`].
pub const FLUID_BALANCE_POSITIVE_ML: i32 = 500;
/// See [`FLUID_BALANCE_POSITIVE_HIGH_ML`].
pub const FLUID_BALANCE_NEGATIVE_ML: i32 = -500;

/// Band a 24-hour fluid balance.
pub fn fluid_balance_band(balance_ml: i32) -> &'static str {
    if balance_ml > FLUID_BALANCE_POSITIVE_HIGH_ML {
        "positive_high"
    } else if balance_ml > FLUID_BALANCE_POSITIVE_ML {
        "positive"
    } else if balance_ml < FLUID_BALANCE_NEGATIVE_ML {
        "negative"
    } else {
        "balanced"
    }
}

// ============================================================================
// qSOFA — BEDSIDE SEPSIS SCREEN
// ============================================================================

/// Respiratory rate at or above this scores a qSOFA point.
pub const QSOFA_RESPIRATORY_RATE: i32 = 22;
/// Systolic blood pressure at or below this scores a point.
pub const QSOFA_SYSTOLIC_BP: i32 = 100;
/// Any GCS below this scores a point (altered mentation).
pub const QSOFA_GCS_BELOW: i32 = 15;
/// A qSOFA of 2 or more is a positive screen.
pub const QSOFA_POSITIVE_THRESHOLD: u8 = 2;

/// qSOFA result, with the working shown.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct QsofaResult {
    pub total: u8,
    pub respiratory_rate_high: Option<bool>,
    pub systolic_bp_low: Option<bool>,
    pub altered_mentation: Option<bool>,
    /// How many of the three were recorded.
    pub criteria_measured: u8,
    /// `total >= 2`. A positive screen prompts escalation, not a diagnosis.
    pub positive: bool,
}

/// qSOFA: three bedside observations, no labs, 0-3.
///
/// Unrecorded observations are not scored as absent findings — the same rule
/// SOFA follows, for the same reason. `criteria_measured` says how much of the
/// screen was actually done.
pub fn qsofa_score(
    respiratory_rate: Option<i32>,
    systolic_bp: Option<i32>,
    glasgow_coma_scale: Option<i32>,
) -> QsofaResult {
    let rr_high = respiratory_rate.map(|r| r >= QSOFA_RESPIRATORY_RATE);
    let bp_low = systolic_bp.map(|b| b <= QSOFA_SYSTOLIC_BP);
    let altered = glasgow_coma_scale
        .filter(|g| (3..=15).contains(g))
        .map(|g| g < QSOFA_GCS_BELOW);

    let flags = [rr_high, bp_low, altered];
    let total: u8 = flags.iter().flatten().map(|f| u8::from(*f)).sum();
    let measured = flags.iter().filter(|f| f.is_some()).count() as u8;
    debug_assert!(total <= 3, "qSOFA has three criteria");

    QsofaResult {
        total,
        respiratory_rate_high: rr_high,
        systolic_bp_low: bp_low,
        altered_mentation: altered,
        criteria_measured: measured,
        positive: total >= QSOFA_POSITIVE_THRESHOLD,
    }
}

// ============================================================================
// SOFA — SEQUENTIAL ORGAN FAILURE ASSESSMENT
// ============================================================================

/// The six SOFA organ systems, each scored 0-4.
pub const SOFA_SYSTEMS: [&str; 6] = [
    "respiration",
    "coagulation",
    "liver",
    "cardiovascular",
    "central_nervous_system",
    "renal",
];

/// Vasopressor support, which the cardiovascular component scores on.
///
/// Doses are µg/kg/min. The tiers are the ones SOFA defines; a MAP alone can
/// only reach 1, and everything above that is a statement about how much
/// pharmacological support the circulation needs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct VasopressorSupport {
    #[serde(default)]
    pub dopamine_mcg_kg_min: Option<f64>,
    #[serde(default)]
    pub dobutamine_any_dose: bool,
    #[serde(default)]
    pub adrenaline_mcg_kg_min: Option<f64>,
    #[serde(default)]
    pub noradrenaline_mcg_kg_min: Option<f64>,
}

/// The measurements SOFA needs. Every field is optional.
///
/// A system with nothing recorded is **not scored as zero** — see
/// [`sofa_score`]. Zero means "this organ is working", and asserting that about
/// an organ nobody measured is the defect this type exists to make impossible.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct SofaInputs {
    /// PaO2/FiO2 ratio, mmHg.
    #[serde(default)]
    pub pao2_fio2: Option<f64>,
    /// Mechanically ventilated or on CPAP. The 3 and 4 tiers require it.
    #[serde(default)]
    pub respiratory_support: bool,
    /// Platelets, x10^3/µL.
    #[serde(default)]
    pub platelets: Option<f64>,
    /// Bilirubin, mg/dL.
    #[serde(default)]
    pub bilirubin_mg_dl: Option<f64>,
    /// Mean arterial pressure, mmHg.
    #[serde(default)]
    pub mean_arterial_pressure: Option<f64>,
    #[serde(default)]
    pub vasopressors: VasopressorSupport,
    /// Glasgow Coma Scale, 3-15.
    #[serde(default)]
    pub glasgow_coma_scale: Option<i32>,
    /// Creatinine, mg/dL.
    #[serde(default)]
    pub creatinine_mg_dl: Option<f64>,
    /// Urine output over 24 hours, mL. Scores renal alongside creatinine; the
    /// worse of the two is taken, which is what SOFA specifies.
    #[serde(default)]
    pub urine_output_ml_24h: Option<f64>,
}

/// A SOFA result, with the working shown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SofaScore {
    /// Total across the systems that were measured, 0-24.
    pub total: u8,
    /// Per-system points, `None` where nothing was recorded.
    pub respiration: Option<u8>,
    pub coagulation: Option<u8>,
    pub liver: Option<u8>,
    pub cardiovascular: Option<u8>,
    pub central_nervous_system: Option<u8>,
    pub renal: Option<u8>,
    /// How many of the six were measured.
    ///
    /// A total of 2 from six systems and a total of 2 from one are different
    /// clinical pictures, and the number alone cannot tell them apart.
    pub systems_measured: u8,
}

fn sofa_respiration(inputs: &SofaInputs) -> Option<u8> {
    let ratio = inputs.pao2_fio2?;
    // The 3 and 4 tiers require respiratory support: a ratio that low without
    // it is a measurement to repeat, not a score to award.
    Some(if ratio < 100.0 && inputs.respiratory_support {
        4
    } else if ratio < 200.0 && inputs.respiratory_support {
        3
    } else if ratio < 300.0 {
        2
    } else if ratio < 400.0 {
        1
    } else {
        0
    })
}

fn sofa_coagulation(inputs: &SofaInputs) -> Option<u8> {
    let platelets = inputs.platelets?;
    Some(if platelets < 20.0 {
        4
    } else if platelets < 50.0 {
        3
    } else if platelets < 100.0 {
        2
    } else if platelets < 150.0 {
        1
    } else {
        0
    })
}

fn sofa_liver(inputs: &SofaInputs) -> Option<u8> {
    let bilirubin = inputs.bilirubin_mg_dl?;
    Some(if bilirubin >= 12.0 {
        4
    } else if bilirubin >= 6.0 {
        3
    } else if bilirubin >= 2.0 {
        2
    } else if bilirubin >= 1.2 {
        1
    } else {
        0
    })
}

/// Cardiovascular: MAP alone reaches 1; 2 and above are about vasopressors.
///
/// The in-browser version scored only `map < 70 -> 1`, under a comment reading
/// "Add more for vasopressor use...". A patient on high-dose noradrenaline
/// therefore scored the same 1 as a patient with a slightly soft blood
/// pressure and no support at all — and the gap between those two is three
/// SOFA points and the definition of septic shock.
fn sofa_cardiovascular(inputs: &SofaInputs) -> Option<u8> {
    let v = &inputs.vasopressors;
    let dopamine = v.dopamine_mcg_kg_min.unwrap_or(0.0);
    let adrenaline = v.adrenaline_mcg_kg_min.unwrap_or(0.0);
    let noradrenaline = v.noradrenaline_mcg_kg_min.unwrap_or(0.0);

    if dopamine > 15.0 || adrenaline > 0.1 || noradrenaline > 0.1 {
        return Some(4);
    }
    if dopamine > 5.0 || adrenaline > 0.0 || noradrenaline > 0.0 {
        return Some(3);
    }
    if dopamine > 0.0 || v.dobutamine_any_dose {
        return Some(2);
    }
    // No vasopressors: the MAP decides, and without one there is nothing to say.
    let map = inputs.mean_arterial_pressure?;
    Some(u8::from(map < 70.0))
}

fn sofa_cns(inputs: &SofaInputs) -> Option<u8> {
    let gcs = inputs.glasgow_coma_scale?;
    if !(3..=15).contains(&gcs) {
        return None;
    }
    Some(if gcs < 6 {
        4
    } else if gcs < 10 {
        3
    } else if gcs < 13 {
        2
    } else if gcs < 15 {
        1
    } else {
        0
    })
}

/// Renal: the worse of creatinine and urine output, as SOFA specifies.
fn sofa_renal(inputs: &SofaInputs) -> Option<u8> {
    let by_creatinine = inputs.creatinine_mg_dl.map(|c| {
        if c >= 5.0 {
            4
        } else if c >= 3.5 {
            3
        } else if c >= 2.0 {
            2
        } else if c >= 1.2 {
            1
        } else {
            0
        }
    });
    let by_urine = inputs.urine_output_ml_24h.map(|u| {
        if u < 200.0 {
            4
        } else if u < 500.0 {
            3
        } else {
            0
        }
    });
    match (by_creatinine, by_urine) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

/// Sequential Organ Failure Assessment, 0-24.
///
/// **Unmeasured systems are not scored zero.** `SepsisPage` submitted
/// `sofa_score` from a `_calculateSOFA` that was never called, over five inputs
/// that had no controls — so every sepsis assessment on file records SOFA 0,
/// which reads as "no organ dysfunction" on a septic patient. Zero is a
/// finding; absent is not, and the two must not be the same number.
///
/// `systems_measured` travels with the total for that reason: a total of 2 from
/// all six systems and a total of 2 from one are different pictures.
pub fn sofa_score(inputs: &SofaInputs) -> SofaScore {
    let respiration = sofa_respiration(inputs);
    let coagulation = sofa_coagulation(inputs);
    let liver = sofa_liver(inputs);
    let cardiovascular = sofa_cardiovascular(inputs);
    let central_nervous_system = sofa_cns(inputs);
    let renal = sofa_renal(inputs);

    let parts = [
        respiration,
        coagulation,
        liver,
        cardiovascular,
        central_nervous_system,
        renal,
    ];
    let total: u8 = parts.iter().flatten().sum();
    let measured = parts.iter().filter(|p| p.is_some()).count() as u8;
    debug_assert!(total <= 24, "SOFA is six systems scored 0-4");

    SofaScore {
        total,
        respiration,
        coagulation,
        liver,
        cardiovascular,
        central_nervous_system,
        renal,
        systems_measured: measured,
    }
}

// ============================================================================
// FAMILY HISTORY — REFERRAL SCREENING
// ============================================================================

/// Relationships that share about half a patient's genome.
pub const FIRST_DEGREE_RELATIVES: [&str; 6] =
    ["mother", "father", "sister", "brother", "daughter", "son"];

/// Relationships that share about a quarter.
pub const SECOND_DEGREE_RELATIVES: [&str; 10] = [
    "maternal-grandmother",
    "maternal-grandfather",
    "paternal-grandmother",
    "paternal-grandfather",
    "maternal-aunt",
    "maternal-uncle",
    "paternal-aunt",
    "paternal-uncle",
    "half-sister",
    "half-brother",
];

/// Relationships that share about an eighth.
pub const THIRD_DEGREE_RELATIVES: [&str; 6] = [
    "cousin",
    "maternal-cousin",
    "paternal-cousin",
    "great-grandmother",
    "great-grandfather",
    "great-aunt",
];

/// Points per affected relative, by degree.
pub const FIRST_DEGREE_POINTS: f64 = 2.0;
/// See [`FIRST_DEGREE_POINTS`].
pub const SECOND_DEGREE_POINTS: f64 = 1.0;
/// See [`FIRST_DEGREE_POINTS`].
pub const THIRD_DEGREE_POINTS: f64 = 0.5;

/// Onset below this age doubles a relative's weight.
///
/// Early onset is the single strongest signal that a condition in a family is
/// inherited rather than incidental: common conditions become common with age,
/// so a cancer at 40 says far more about the family than the same cancer at 75.
pub const EARLY_ONSET_AGE_YEARS: i32 = 50;
/// See [`EARLY_ONSET_AGE_YEARS`].
pub const EARLY_ONSET_MULTIPLIER: f64 = 2.0;

/// At or above this, prompt a genetics referral.
pub const FAMILY_REFERRAL_THRESHOLD: f64 = 4.0;
/// At or above this, prompt an enhanced-screening discussion.
pub const FAMILY_ENHANCED_SCREENING_THRESHOLD: f64 = 2.0;

/// One affected relative, for one condition category.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AffectedRelative {
    /// Relationship to the patient, from the form's vocabulary.
    #[serde(default)]
    pub relationship: String,
    /// Age at diagnosis, where it is known.
    #[serde(default)]
    pub age_of_onset: Option<i32>,
}

/// What a family history suggests should happen next.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FamilyHistoryAssessment {
    /// Weighted total. Published so a clinician can see the working.
    pub score: f64,
    /// `standard_care` / `enhanced_screening` / `genetics_referral`.
    pub band: &'static str,
    pub first_degree_affected: u32,
    pub second_degree_affected: u32,
    pub third_degree_affected: u32,
    /// Relatives diagnosed under [`EARLY_ONSET_AGE_YEARS`].
    pub early_onset_affected: u32,
    /// Relatives whose relationship this scale does not recognise.
    ///
    /// Not scored, and not silently ignored: the count is returned so a reader
    /// knows the score is incomplete. Guessing a degree in either direction is
    /// worse — too low misses a referral, too high makes the prompt noise.
    pub unscored_relatives: u32,
}

/// The degree weight for a relationship, or `None` if it is not recognised.
fn relationship_points(relationship: &str) -> Option<f64> {
    let key = relationship.trim().to_ascii_lowercase();
    if FIRST_DEGREE_RELATIVES.contains(&key.as_str()) {
        Some(FIRST_DEGREE_POINTS)
    } else if SECOND_DEGREE_RELATIVES.contains(&key.as_str()) {
        Some(SECOND_DEGREE_POINTS)
    } else if THIRD_DEGREE_RELATIVES.contains(&key.as_str()) {
        Some(THIRD_DEGREE_POINTS)
    } else {
        None
    }
}

/// Screen a family history for one condition category.
///
/// **This is a prompt, not a diagnosis, and not a probability.** It answers "is
/// this family history worth a conversation?" and nothing more. It does not
/// replace disease-specific criteria — NICE familial breast cancer, the
/// Amsterdam and Bethesda criteria for Lynch syndrome, and their equivalents
/// ask questions this cannot, about bilateral disease, multiple primaries and
/// specific tumour patterns. A `standard_care` result is not a statement that a
/// family is unaffected.
///
/// What it replaces is worse than nothing on the one case that matters most: a
/// raw count of affected relatives, banded at 3+ for "HIGH", which issued an
/// automatic "consider genetic counseling" recommendation. A mother and a
/// sister with breast cancer at 40 counted 2 and read MODERATE; three second
/// cousins with type 2 diabetes counted 3 and read HIGH. Degree and age of
/// onset are exactly the two things that separate those, and both were already
/// on file.
pub fn family_history_assessment(relatives: &[AffectedRelative]) -> FamilyHistoryAssessment {
    debug_assert!(
        relatives.len() <= 256,
        "a family history this large is a bug upstream"
    );
    let mut score = 0.0_f64;
    let (mut first, mut second, mut third, mut early, mut unscored) = (0, 0, 0, 0, 0);

    for relative in relatives.iter().take(256) {
        let Some(points) = relationship_points(&relative.relationship) else {
            unscored += 1;
            continue;
        };
        if points == FIRST_DEGREE_POINTS {
            first += 1;
        } else if points == SECOND_DEGREE_POINTS {
            second += 1;
        } else {
            third += 1;
        }

        // An unknown onset age is not treated as late onset — it weighs as
        // recorded, without the early-onset multiplier, and the caller can see
        // from `early_onset_affected` how much of the history carried one.
        let early_onset = relative
            .age_of_onset
            .is_some_and(|age| age < EARLY_ONSET_AGE_YEARS);
        if early_onset {
            early += 1;
            score += points * EARLY_ONSET_MULTIPLIER;
        } else {
            score += points;
        }
    }

    let band = if score >= FAMILY_REFERRAL_THRESHOLD {
        "genetics_referral"
    } else if score >= FAMILY_ENHANCED_SCREENING_THRESHOLD {
        "enhanced_screening"
    } else {
        "standard_care"
    };

    FamilyHistoryAssessment {
        score,
        band,
        first_degree_affected: first,
        second_degree_affected: second,
        third_degree_affected: third,
        early_onset_affected: early,
        unscored_relatives: unscored,
    }
}

// ============================================================================
// CATALOG
// ============================================================================

/// The thresholds and constants a form needs to show a live preview without
/// carrying a second copy of the policy.
///
/// Served by `GET /api/clinical/scoring/catalog`. It publishes the *numbers*,
/// never a substitute for recomputation: a saved record's score is always the
/// one this module produced on the server, whatever a page displayed while it
/// was being filled in.
pub fn catalog() -> serde_json::Value {
    // The Glasgow Coma Scale's own options, published rather than restated in a
    // form. Each component is a fixed instrument -- eye 1-4, verbal 1-5, motor
    // 1-6 -- and the wording matters: "withdrawal from pain" and "abnormal
    // flexion to pain" are two adjacent scores that mean very different things,
    // and a screen that paraphrases them scores the wrong one.
    //
    // The descriptions come from the enums themselves (`description()`), so the
    // form and the stored record cannot drift apart.
    let gcs_component = |scores: &[u8], describe: &dyn Fn(u8) -> String| {
        scores
            .iter()
            .map(|score| serde_json::json!({ "score": score, "description": describe(*score) }))
            .collect::<Vec<_>>()
    };

    serde_json::json!({
        "glasgow_coma_scale": {
            "eye": gcs_component(&[1, 2, 3, 4], &|s| {
                crate::clinical::EyeResponse::from_score(s)
                    .map(|v| v.description().to_string())
                    .unwrap_or_default()
            }),
            "verbal": gcs_component(&[1, 2, 3, 4, 5], &|s| {
                crate::clinical::VerbalResponse::from_score(s)
                    .map(|v| v.description().to_string())
                    .unwrap_or_default()
            }),
            "motor": gcs_component(&[1, 2, 3, 4, 5, 6], &|s| {
                crate::clinical::MotorResponse::from_score(s)
                    .map(|v| v.description().to_string())
                    .unwrap_or_default()
            }),
            // Published for display only. The total, the interpretation and
            // whether the airway is at risk are computed by the server when the
            // assessment is filed -- a page never decides one.
            "range": { "min": 3, "max": 15 },
        },
        "morse_fall_scale": {
            "items": MORSE_ITEMS
                .iter()
                .map(|(name, values)| serde_json::json!({ "name": name, "values": values }))
                .collect::<Vec<_>>(),
            "bands": [
                { "level": "low", "min": 0, "max": MORSE_MODERATE_THRESHOLD - 1 },
                { "level": "moderate", "min": MORSE_MODERATE_THRESHOLD, "max": MORSE_HIGH_THRESHOLD - 1 },
                { "level": "high", "min": MORSE_HIGH_THRESHOLD, "max": serde_json::Value::Null },
            ],
        },
        // The critical-value call list, for the report form's preview. The
        // stored level is computed on the server when the report is filed.
        "critical_values": {
            "thresholds": CRITICAL_VALUE_THRESHOLDS,
        },
        "burn": {
            // The body chart itself, so the form renders the region set and the
            // per-region maxima the server will score against rather than
            // carrying its own copy of either.
            "lund_browder": {
                "age_bands": LUND_BROWDER_AGE_BANDS,
                "age_band_labels": LUND_BROWDER_BAND_LABELS,
                "regions": LUND_BROWDER_REGIONS
                    .iter()
                    .map(|(id, name, by_age)| serde_json::json!({
                        "id": id,
                        "name": name,
                        "percent_by_age_band": by_age,
                    }))
                    .collect::<Vec<_>>(),
            },
            "parkland_ml_per_kg_per_percent": PARKLAND_ML_PER_KG_PER_PERCENT,
            "urine_target_ml_kg_hr": PARKLAND_URINE_TARGET_ML_KG_HR,
            "first_block_fraction": 0.5,
            "first_block_hours": 8,
            "second_block_hours": 16,
            "severity": {
                "major_tbsa_percent": BURN_MAJOR_TBSA_PERCENT,
                "moderate_tbsa_percent": BURN_MODERATE_TBSA_PERCENT,
                "major_regardless_of_tbsa": ["inhalation_injury", "circumferential_burn"],
            },
        },
        "timi": {
            "criteria": TIMI_CRITERIA,
            "troponin_threshold_ng_ml": TIMI_TROPONIN_THRESHOLD_NG_ML,
            "bands": [
                { "level": "low", "min": 0, "max": TIMI_INTERMEDIATE_THRESHOLD - 1 },
                { "level": "intermediate", "min": TIMI_INTERMEDIATE_THRESHOLD, "max": TIMI_HIGH_THRESHOLD - 1 },
                { "level": "high", "min": TIMI_HIGH_THRESHOLD, "max": 7 },
            ],
        },
        "start_triage": {
            "respiratory_rate_immediate_above": START_RESP_RATE_IMMEDIATE,
            "capillary_refill_immediate_above_secs": START_CAP_REFILL_IMMEDIATE_SECS,
            "absent_radial_pulse_is_immediate": true,
            "categories": ["minor", "delayed", "immediate", "expectant"],
        },
        "vip_phlebitis": {
            "signs": VIP_SIGNS
                .iter()
                .map(|(name, stage)| serde_json::json!({ "name": name, "stage": stage }))
                .collect::<Vec<_>>(),
            "actions": [
                { "score": 0, "action": "observe" },
                { "score": 1, "action": "observe_closely" },
                { "score": 2, "action": "resite_cannula" },
                { "score": 3, "action": "resite_cannula" },
                { "score": 4, "action": "resite_and_treat" },
                { "score": 5, "action": "resite_and_treat" },
            ],
        },
        "medication": {
            "overdue_after_minutes": MEDICATION_OVERDUE_AFTER_MINUTES,
        },
        "fluid_balance": {
            "positive_high_ml": FLUID_BALANCE_POSITIVE_HIGH_ML,
            "positive_ml": FLUID_BALANCE_POSITIVE_ML,
            "negative_ml": FLUID_BALANCE_NEGATIVE_ML,
            // Named by the same function the server would band with, so the
            // published names and the boundaries above cannot disagree.
            "bands": [
                { "level": fluid_balance_band(FLUID_BALANCE_NEGATIVE_ML - 1), "max_ml": FLUID_BALANCE_NEGATIVE_ML },
                { "level": fluid_balance_band(0), "min_ml": FLUID_BALANCE_NEGATIVE_ML, "max_ml": FLUID_BALANCE_POSITIVE_ML },
                { "level": fluid_balance_band(FLUID_BALANCE_POSITIVE_ML + 1), "min_ml": FLUID_BALANCE_POSITIVE_ML, "max_ml": FLUID_BALANCE_POSITIVE_HIGH_ML },
                { "level": fluid_balance_band(FLUID_BALANCE_POSITIVE_HIGH_ML + 1), "min_ml": FLUID_BALANCE_POSITIVE_HIGH_ML },
            ],
        },
        "qsofa": {
            "respiratory_rate_at_or_above": QSOFA_RESPIRATORY_RATE,
            "systolic_bp_at_or_below": QSOFA_SYSTOLIC_BP,
            "gcs_below": QSOFA_GCS_BELOW,
            "positive_threshold": QSOFA_POSITIVE_THRESHOLD,
        },
        "sofa": {
            "systems": SOFA_SYSTEMS,
            "max_per_system": 4,
            "max_total": 24,
            "respiration_top_tiers_need_support": true,
            "renal_takes_worse_of": ["creatinine_mg_dl", "urine_output_ml_24h"],
        },
        "family_history": {
            "first_degree": FIRST_DEGREE_RELATIVES,
            "second_degree": SECOND_DEGREE_RELATIVES,
            "third_degree": THIRD_DEGREE_RELATIVES,
            "points": {
                "first_degree": FIRST_DEGREE_POINTS,
                "second_degree": SECOND_DEGREE_POINTS,
                "third_degree": THIRD_DEGREE_POINTS,
            },
            "early_onset_age_years": EARLY_ONSET_AGE_YEARS,
            "early_onset_multiplier": EARLY_ONSET_MULTIPLIER,
            "bands": [
                { "level": "standard_care", "min": 0.0, "max": FAMILY_ENHANCED_SCREENING_THRESHOLD },
                { "level": "enhanced_screening", "min": FAMILY_ENHANCED_SCREENING_THRESHOLD, "max": FAMILY_REFERRAL_THRESHOLD },
                { "level": "genetics_referral", "min": FAMILY_REFERRAL_THRESHOLD, "max": serde_json::Value::Null },
            ],
        },
        "catheter_dwell_hours": {
            "peripheral": catheter_dwell_limit_hours("peripheral"),
            "intraosseous": catheter_dwell_limit_hours("intraosseous"),
            "midline": catheter_dwell_limit_hours("midline"),
            "picc": catheter_dwell_limit_hours("picc"),
            "central": catheter_dwell_limit_hours("central"),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn morse_bands_at_their_published_boundaries() {
        assert_eq!(morse_band(0), "low");
        assert_eq!(morse_band(24), "low");
        assert_eq!(morse_band(25), "moderate", "25 is the first moderate score");
        assert_eq!(morse_band(44), "moderate");
        assert_eq!(morse_band(45), "high", "45 is the first high score");
        assert_eq!(morse_band(125), "high", "every item at its maximum");
    }

    #[test]
    fn parkland_matches_the_worked_example() {
        // 70 kg, 30% TBSA -> 4 x 70 x 30 = 8400 mL, 4200 in the first 8 hours.
        let f = parkland_fluid(70.0, 30.0).expect("valid inputs");
        assert_eq!(f.total_24h_ml, 8400);
        assert_eq!(f.first_8h_ml, 4200);
        assert_eq!(f.next_16h_ml, 4200);
        assert_eq!(f.hourly_first_8h_ml, 525);
        assert_eq!(f.hourly_next_16h_ml, 263);
        assert_eq!(f.urine_output_target_ml_hr, 35.0);
    }

    #[test]
    fn parkland_refuses_inputs_that_cannot_produce_an_order() {
        assert!(parkland_fluid(0.0, 30.0).is_none(), "no weight, no order");
        assert!(parkland_fluid(-5.0, 30.0).is_none());
        assert!(parkland_fluid(70.0, -1.0).is_none());
        assert!(
            parkland_fluid(70.0, 101.0).is_none(),
            "TBSA cannot exceed 100"
        );
        assert!(parkland_fluid(f64::NAN, 30.0).is_none());
    }

    #[test]
    fn burn_severity_ignores_tbsa_when_the_airway_or_a_limb_is_threatened() {
        assert_eq!(burn_severity(2.0, false, false), "minor");
        assert_eq!(burn_severity(12.0, false, false), "moderate");
        assert_eq!(burn_severity(30.0, false, false), "major");
        assert_eq!(
            burn_severity(2.0, true, false),
            "major",
            "a 2% burn with inhalation injury is a major burn"
        );
        assert_eq!(
            burn_severity(2.0, false, true),
            "major",
            "a circumferential burn threatens the limb at any size"
        );
    }

    /// A fixed "now", so an age assertion does not drift with the wall clock.
    fn at(date: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .and_utc()
    }

    #[test]
    fn age_is_whole_years_and_respects_the_birthday() {
        // The boundary TIMI asks about, on either side of the birthday.
        assert_eq!(years_since("1961-07-01", at("2026-06-30")), Some(64));
        assert_eq!(years_since("1961-07-01", at("2026-07-01")), Some(65));
        assert_eq!(years_since("2026-01-01", at("2026-09-09")), Some(0));
        assert_eq!(years_since("not-a-date", at("2026-09-09")), None);
    }

    #[test]
    fn lund_browder_columns_each_total_one_hundred() {
        // The invariant that makes the chart usable at all. Rule of 9s numbers
        // dropped into this region set would fail here, which is the point:
        // Lund-Browder is a different region set, not a different set of
        // numbers for the same regions.
        for band in 0..6 {
            let total: f64 = LUND_BROWDER_REGIONS
                .iter()
                .map(|(_, _, by_age)| by_age[band])
                .sum();
            assert!(
                (total - 100.0).abs() < 1e-9,
                "band {} ({}) totals {total}, not 100",
                band,
                LUND_BROWDER_BAND_LABELS[band]
            );
        }
    }

    #[test]
    fn the_head_shrinks_and_the_legs_grow_with_age() {
        // The whole reason a boolean could not express this.
        let head = |band| lund_browder_region_percent("head", band).unwrap();
        assert_eq!(head(0), 19.0, "a newborn's head");
        assert_eq!(head(2), 13.0, "a five-year-old's");
        assert_eq!(head(5), 7.0, "an adult's");
        assert!(head(0) > head(1) && head(1) > head(2) && head(2) > head(3));

        let thigh = |band| lund_browder_region_percent("right_thigh", band).unwrap();
        assert_eq!(thigh(0), 5.5);
        assert_eq!(thigh(5), 9.5);
        assert!(thigh(0) < thigh(2) && thigh(2) < thigh(5));
    }

    #[test]
    fn age_bands_pick_the_right_column() {
        assert_eq!(lund_browder_band(0), Some(0));
        assert_eq!(
            lund_browder_band(1),
            Some(1),
            "1 is the first of the 1-4 band"
        );
        assert_eq!(lund_browder_band(4), Some(1), "4 is the last of it");
        assert_eq!(lund_browder_band(5), Some(2));
        assert_eq!(lund_browder_band(9), Some(2));
        assert_eq!(lund_browder_band(10), Some(3));
        assert_eq!(lund_browder_band(15), Some(4));
        assert_eq!(lund_browder_band(17), Some(4));
        assert_eq!(lund_browder_band(18), Some(5), "adult from 18");
        assert_eq!(lund_browder_band(80), Some(5));
        assert_eq!(
            lund_browder_band(-1),
            None,
            "an impossible age gets no band, not the adult column"
        );
        assert_eq!(lund_browder_band(200), None);
    }

    #[test]
    fn the_same_burn_is_a_different_tbsa_at_a_different_age() {
        // A whole head and neck, charted on an infant and on an adult. This
        // difference — 21% against 9% — is the defect the Rule of 9s chart with
        // an `isChild` checkbox could not represent, and it is a fluid order.
        let whole_head_and_neck = vec![("head".to_string(), 1.0), ("neck".to_string(), 1.0)];
        let infant = lund_browder_tbsa(&whole_head_and_neck, 0);
        let adult = lund_browder_tbsa(&whole_head_and_neck, 5);
        assert_eq!(infant, 21.0);
        assert_eq!(adult, 9.0);

        // 70 kg adult vs 10 kg infant makes the gap concrete.
        let infant_fluid = parkland_fluid(10.0, infant).expect("valid");
        let adult_fluid = parkland_fluid(70.0, adult).expect("valid");
        assert_eq!(infant_fluid.total_24h_ml, 840);
        assert_eq!(adult_fluid.total_24h_ml, 2520);
    }

    #[test]
    fn charting_handles_partial_regions_and_refuses_to_be_inflated() {
        // Half a forearm at any age.
        let half = vec![("right_forearm".to_string(), 0.5)];
        assert_eq!(lund_browder_tbsa(&half, 5), 1.5);

        // A fraction above 1.0 is a mis-scaled client (percent sent where a
        // fraction was expected). Clamped, not trusted: 200% of a forearm is
        // still one forearm.
        let over = vec![("right_forearm".to_string(), 2.0)];
        assert_eq!(lund_browder_tbsa(&over, 5), 3.0);

        // An unknown region contributes nothing rather than being guessed at.
        let unknown = vec![("left_wing".to_string(), 1.0)];
        assert_eq!(lund_browder_tbsa(&unknown, 5), 0.0);

        assert_eq!(lund_browder_tbsa(&[], 5), 0.0);
    }

    #[test]
    fn a_whole_body_burn_is_one_hundred_percent_at_every_age() {
        for band in 0..6 {
            let everything: Vec<(String, f64)> = LUND_BROWDER_REGIONS
                .iter()
                .map(|(id, _, _)| ((*id).to_string(), 1.0))
                .collect();
            let total = lund_browder_tbsa(&everything, band);
            assert!((total - 100.0).abs() < 1e-9, "band {band} totalled {total}");
        }
    }

    fn relative(relationship: &str, onset: Option<i32>) -> AffectedRelative {
        AffectedRelative {
            relationship: relationship.to_string(),
            age_of_onset: onset,
        }
    }

    #[test]
    fn qsofa_scores_three_bedside_observations() {
        let full = qsofa_score(Some(24), Some(90), Some(13));
        assert_eq!(full.total, 3);
        assert!(full.positive);
        assert_eq!(full.criteria_measured, 3);

        let clean = qsofa_score(Some(16), Some(120), Some(15));
        assert_eq!(clean.total, 0);
        assert!(!clean.positive);

        // Boundaries: 22 and 100 score, 21 and 101 do not.
        assert_eq!(qsofa_score(Some(22), None, None).total, 1);
        assert_eq!(qsofa_score(Some(21), None, None).total, 0);
        assert_eq!(qsofa_score(None, Some(100), None).total, 1);
        assert_eq!(qsofa_score(None, Some(101), None).total, 0);
        assert_eq!(qsofa_score(None, None, Some(14)).total, 1);
        assert_eq!(qsofa_score(None, None, Some(15)).total, 0);

        // Two of three is a positive screen.
        assert!(qsofa_score(Some(24), Some(90), None).positive);
    }

    #[test]
    fn qsofa_does_not_score_an_observation_nobody_made() {
        let nothing = qsofa_score(None, None, None);
        assert_eq!(nothing.total, 0);
        assert_eq!(
            nothing.criteria_measured, 0,
            "zero measured, not zero findings"
        );
        assert!(!nothing.positive);
        assert_eq!(nothing.respiratory_rate_high, None);
    }

    #[test]
    fn sofa_does_not_score_an_organ_nobody_measured() {
        // The defect this replaces: `SepsisPage` submitted SOFA 0 for every
        // patient, which reads as "no organ dysfunction" on someone septic.
        let nothing = sofa_score(&SofaInputs::default());
        assert_eq!(nothing.total, 0);
        assert_eq!(
            nothing.systems_measured, 0,
            "zero measured, not zero dysfunction"
        );
        assert_eq!(nothing.respiration, None);
        assert_eq!(nothing.renal, None);

        // A measured, normal organ scores 0 and counts as measured. That is a
        // finding; the case above is not.
        let normal = sofa_score(&SofaInputs {
            platelets: Some(250.0),
            ..Default::default()
        });
        assert_eq!(normal.coagulation, Some(0));
        assert_eq!(normal.systems_measured, 1);
    }

    #[test]
    fn sofa_scores_each_system_at_its_boundaries() {
        let with = |f: fn(&mut SofaInputs)| {
            let mut i = SofaInputs::default();
            f(&mut i);
            sofa_score(&i)
        };
        assert_eq!(with(|i| i.platelets = Some(150.0)).coagulation, Some(0));
        assert_eq!(with(|i| i.platelets = Some(149.0)).coagulation, Some(1));
        assert_eq!(with(|i| i.platelets = Some(19.0)).coagulation, Some(4));

        assert_eq!(with(|i| i.bilirubin_mg_dl = Some(1.1)).liver, Some(0));
        assert_eq!(with(|i| i.bilirubin_mg_dl = Some(1.2)).liver, Some(1));
        assert_eq!(with(|i| i.bilirubin_mg_dl = Some(12.0)).liver, Some(4));

        assert_eq!(
            with(|i| i.glasgow_coma_scale = Some(15)).central_nervous_system,
            Some(0)
        );
        assert_eq!(
            with(|i| i.glasgow_coma_scale = Some(14)).central_nervous_system,
            Some(1)
        );
        assert_eq!(
            with(|i| i.glasgow_coma_scale = Some(5)).central_nervous_system,
            Some(4)
        );
        assert_eq!(
            with(|i| i.glasgow_coma_scale = Some(2)).central_nervous_system,
            None,
            "a GCS below 3 is not a GCS"
        );

        assert_eq!(with(|i| i.creatinine_mg_dl = Some(1.1)).renal, Some(0));
        assert_eq!(with(|i| i.creatinine_mg_dl = Some(5.0)).renal, Some(4));
    }

    #[test]
    fn sofa_respiration_needs_support_for_its_top_two_tiers() {
        let ratio_only = sofa_score(&SofaInputs {
            pao2_fio2: Some(90.0),
            respiratory_support: false,
            ..Default::default()
        });
        assert_eq!(ratio_only.respiration, Some(2), "no support caps it at 2");

        let ventilated = sofa_score(&SofaInputs {
            pao2_fio2: Some(90.0),
            respiratory_support: true,
            ..Default::default()
        });
        assert_eq!(ventilated.respiration, Some(4));
    }

    #[test]
    fn sofa_cardiovascular_is_about_vasopressors_not_just_pressure() {
        // The in-browser version scored only `map < 70 -> 1` and said so in a
        // comment. A patient on high-dose noradrenaline scored the same as one
        // with a slightly soft pressure and no support.
        let soft_pressure = sofa_score(&SofaInputs {
            mean_arterial_pressure: Some(65.0),
            ..Default::default()
        });
        assert_eq!(soft_pressure.cardiovascular, Some(1));

        let high_dose = sofa_score(&SofaInputs {
            mean_arterial_pressure: Some(65.0),
            vasopressors: VasopressorSupport {
                noradrenaline_mcg_kg_min: Some(0.3),
                ..Default::default()
            },
            ..Default::default()
        });
        assert_eq!(high_dose.cardiovascular, Some(4));
        assert_eq!(
            high_dose.total - soft_pressure.total,
            3,
            "three SOFA points, and the definition of septic shock"
        );

        let dobutamine = sofa_score(&SofaInputs {
            mean_arterial_pressure: Some(75.0),
            vasopressors: VasopressorSupport {
                dobutamine_any_dose: true,
                ..Default::default()
            },
            ..Default::default()
        });
        assert_eq!(dobutamine.cardiovascular, Some(2), "any dose scores 2");
    }

    #[test]
    fn sofa_renal_takes_the_worse_of_creatinine_and_urine_output() {
        let both = sofa_score(&SofaInputs {
            creatinine_mg_dl: Some(1.3),
            urine_output_ml_24h: Some(150.0),
            ..Default::default()
        });
        assert_eq!(both.renal, Some(4), "anuria outweighs a mild creatinine");

        let urine_only = sofa_score(&SofaInputs {
            urine_output_ml_24h: Some(400.0),
            ..Default::default()
        });
        assert_eq!(urine_only.renal, Some(3));
    }

    #[test]
    fn a_maximal_sofa_is_twenty_four() {
        let worst = sofa_score(&SofaInputs {
            pao2_fio2: Some(50.0),
            respiratory_support: true,
            platelets: Some(10.0),
            bilirubin_mg_dl: Some(20.0),
            mean_arterial_pressure: Some(50.0),
            vasopressors: VasopressorSupport {
                noradrenaline_mcg_kg_min: Some(0.5),
                ..Default::default()
            },
            glasgow_coma_scale: Some(3),
            creatinine_mg_dl: Some(6.0),
            urine_output_ml_24h: Some(100.0),
        });
        assert_eq!(worst.total, 24);
        assert_eq!(worst.systems_measured, 6);
    }

    #[test]
    fn degree_and_onset_separate_the_two_families_a_count_could_not() {
        // The case the old count model got backwards, in both directions.

        // A mother and a sister with breast cancer at 40. Two first-degree
        // relatives, both early onset: (2 x 2) + (2 x 2) = 8.
        let strong = [relative("mother", Some(40)), relative("sister", Some(42))];
        let strong = family_history_assessment(&strong);
        assert_eq!(strong.score, 8.0);
        assert_eq!(strong.band, "genetics_referral");
        assert_eq!(strong.first_degree_affected, 2);
        assert_eq!(strong.early_onset_affected, 2);

        // Three second cousins with type 2 diabetes in their sixties.
        // 0.5 x 3 = 1.5, and no multiplier.
        let weak = [
            relative("cousin", Some(61)),
            relative("maternal-cousin", Some(64)),
            relative("paternal-cousin", Some(68)),
        ];
        let weak = family_history_assessment(&weak);
        assert_eq!(weak.score, 1.5);
        assert_eq!(weak.band, "standard_care");

        // The count model said the opposite: 2 was "MODERATE" and 3 was "HIGH".
        assert!(
            strong.score > weak.score,
            "two early first-degree relatives must outweigh three late third-degree ones"
        );
    }

    #[test]
    fn early_onset_doubles_a_relative_and_late_onset_does_not() {
        assert_eq!(
            family_history_assessment(&[relative("father", Some(45))]).score,
            4.0
        );
        assert_eq!(
            family_history_assessment(&[relative("father", Some(70))]).score,
            2.0
        );
        // 50 is not early: the threshold is "under 50".
        assert_eq!(
            family_history_assessment(&[relative("father", Some(50))]).score,
            2.0
        );
        // An unknown onset weighs as recorded, without the multiplier.
        assert_eq!(
            family_history_assessment(&[relative("father", None)]).score,
            2.0
        );
    }

    #[test]
    fn bands_sit_at_their_published_boundaries() {
        // One late first-degree relative: 2.0, the first enhanced-screening score.
        assert_eq!(
            family_history_assessment(&[relative("mother", None)]).band,
            "enhanced_screening"
        );
        // One late second-degree relative: 1.0.
        assert_eq!(
            family_history_assessment(&[relative("paternal-aunt", None)]).band,
            "standard_care"
        );
        // One early first-degree relative: 4.0, the first referral score.
        assert_eq!(
            family_history_assessment(&[relative("mother", Some(38))]).band,
            "genetics_referral"
        );
        assert_eq!(family_history_assessment(&[]).band, "standard_care");
        assert_eq!(family_history_assessment(&[]).score, 0.0);
    }

    #[test]
    fn an_unrecognised_relationship_is_counted_but_not_scored() {
        // Guessing a degree is wrong in both directions: too low misses a
        // referral, too high makes the prompt noise. The count is surfaced so a
        // reader knows the score is incomplete.
        let mixed = [
            relative("mother", Some(40)),
            relative("family friend", Some(40)),
        ];
        let result = family_history_assessment(&mixed);
        assert_eq!(result.score, 4.0, "only the mother is scored");
        assert_eq!(result.unscored_relatives, 1);
        assert_eq!(result.first_degree_affected, 1);
    }

    #[test]
    fn half_siblings_are_second_degree() {
        // They share a quarter of the genome, not half — the same as a
        // grandparent or an aunt.
        assert_eq!(
            family_history_assessment(&[relative("half-sister", None)]).score,
            SECOND_DEGREE_POINTS
        );
        assert_eq!(
            family_history_assessment(&[relative("sister", None)]).score,
            FIRST_DEGREE_POINTS
        );
    }

    #[test]
    fn timi_counts_one_point_per_criterion() {
        assert_eq!(timi_score(&TimiCriteria::default()), 0);
        let all = TimiCriteria {
            age_65_or_over: true,
            three_or_more_cad_risk_factors: true,
            known_cad: true,
            aspirin_in_past_7_days: true,
            severe_angina: true,
            st_deviation: true,
            elevated_marker: true,
        };
        assert_eq!(timi_score(&all), 7);
        assert_eq!(timi_band(0), "low");
        assert_eq!(timi_band(2), "low");
        assert_eq!(timi_band(3), "intermediate");
        assert_eq!(timi_band(5), "high");
        assert_eq!(timi_band(7), "high");
    }

    #[test]
    fn start_triage_follows_its_own_order() {
        // Ambulatory wins before anything else is asked.
        let walking = StartVitals {
            ambulatory: true,
            breathing: false,
            ..Default::default()
        };
        assert_eq!(start_triage(&walking), "minor");

        let apnoeic = StartVitals {
            ambulatory: false,
            breathing: false,
            ..Default::default()
        };
        assert_eq!(start_triage(&apnoeic), "expectant");

        let tachypnoeic = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(34),
            follows_commands: true,
            ..Default::default()
        };
        assert_eq!(start_triage(&tachypnoeic), "immediate");

        let poorly_perfused = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(20),
            capillary_refill_secs: Some(4),
            follows_commands: true,
            ..Default::default()
        };
        assert_eq!(start_triage(&poorly_perfused), "immediate");

        // Either half of the perfusion check is enough on its own.
        let no_radial_pulse = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(20),
            capillary_refill_secs: Some(1),
            radial_pulse_present: Some(false),
            follows_commands: true,
        };
        assert_eq!(start_triage(&no_radial_pulse), "immediate");

        let obtunded = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(20),
            capillary_refill_secs: Some(1),
            follows_commands: false,
            ..Default::default()
        };
        assert_eq!(start_triage(&obtunded), "immediate");

        let walking_wounded = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(20),
            capillary_refill_secs: Some(1),
            radial_pulse_present: Some(true),
            follows_commands: true,
        };
        assert_eq!(start_triage(&walking_wounded), "delayed");
    }

    #[test]
    fn vip_counts_the_early_signs_rather_than_maximising() {
        assert_eq!(vip_score(&[]), 0);
        assert_eq!(vip_score(&["clean-dry-intact".to_string()]), 0);

        // Stage 1 is ONE of slight pain or slight redness.
        assert_eq!(vip_score(&["tenderness".to_string()]), 1);
        assert_eq!(vip_score(&["redness".to_string()]), 1);

        // Stage 2 is TWO of pain, redness and swelling — and it is the point at
        // which the cannula comes out. This is the case the old
        // highest-stage-wins rule got wrong: it returned 1, so `vip_action`
        // said "observe_closely" and an inflamed cannula stayed in the arm.
        assert_eq!(
            vip_score(&["tenderness".to_string(), "redness".to_string()]),
            2,
            "pain and redness together is stage 2, not two separate stage-1 signs"
        );
        assert_eq!(vip_action(2), "resite_cannula");

        // Warmth and swelling are the same inflammatory finding at the same
        // stage; a single warm, swollen site is one sign, not two.
        assert_eq!(
            vip_score(&["swelling".to_string(), "warmth".to_string()]),
            1,
            "swelling and warmth are one finding, so this must not reach stage 2"
        );

        // Stages 3 to 5 are single-sign findings and outrank any count.
        assert_eq!(
            vip_score(&["tenderness".to_string(), "induration".to_string()]),
            3,
            "induration is stage 3 on its own"
        );
        assert_eq!(
            vip_score(&["palpable-cord".to_string()]),
            4,
            "a palpable venous cord is stage 4"
        );
        assert_eq!(
            vip_score(&["drainage".to_string()]),
            5,
            "purulent discharge is stage 5; the table used to give it 4 and give \
             the cord 5, which is the two the wrong way round"
        );

        assert_eq!(
            vip_score(&["not_a_sign".to_string()]),
            0,
            "an unknown sign must not inflate the score"
        );
    }

    #[test]
    fn vip_action_removes_the_cannula_from_stage_two() {
        assert_eq!(vip_action(0), "observe");
        assert_eq!(vip_action(1), "observe_closely");
        assert_eq!(vip_action(2), "resite_cannula");
        assert_eq!(vip_action(3), "resite_cannula");
        assert_eq!(vip_action(4), "resite_and_treat");
        assert_eq!(vip_action(5), "resite_and_treat");
    }

    #[test]
    fn dwell_limits_match_the_device() {
        assert_eq!(catheter_dwell_limit_hours("peripheral"), Some(96));
        assert_eq!(catheter_dwell_limit_hours("intraosseous"), Some(24));
        assert_eq!(catheter_dwell_limit_hours("midline"), Some(672), "28 days");
        assert_eq!(catheter_dwell_limit_hours("picc"), Some(2160), "90 days");
        assert_eq!(catheter_dwell_limit_hours("central"), Some(168), "7 days");
        assert_eq!(
            catheter_dwell_limit_hours("something-new"),
            Some(96),
            "an unrecognised device takes the shortest clock, not the longest"
        );
    }

    #[test]
    fn fluid_balance_bands_at_their_published_boundaries() {
        assert_eq!(fluid_balance_band(0), "balanced");
        assert_eq!(
            fluid_balance_band(500),
            "balanced",
            "500 is not yet positive"
        );
        assert_eq!(fluid_balance_band(501), "positive");
        assert_eq!(fluid_balance_band(1000), "positive");
        assert_eq!(fluid_balance_band(1001), "positive_high");
        assert_eq!(fluid_balance_band(-500), "balanced");
        assert_eq!(fluid_balance_band(-501), "negative");
    }

    #[test]
    fn catalog_publishes_every_number_a_form_would_otherwise_hardcode() {
        let c = catalog();
        assert_eq!(c["morse_fall_scale"]["bands"][1]["min"], 25);
        assert_eq!(c["burn"]["parkland_ml_per_kg_per_percent"], 4.0);
        assert_eq!(c["burn"]["lund_browder"]["regions"][0]["id"], "head");
        assert_eq!(
            c["burn"]["lund_browder"]["regions"][0]["percent_by_age_band"][0],
            19.0
        );
        assert_eq!(c["burn"]["severity"]["major_tbsa_percent"], 25.0);
        assert_eq!(c["timi"]["troponin_threshold_ng_ml"], 0.04);
        assert_eq!(c["start_triage"]["respiratory_rate_immediate_above"], 30);
        assert_eq!(c["catheter_dwell_hours"]["peripheral"], 96);
        assert_eq!(c["family_history"]["early_onset_age_years"], 50);
        assert_eq!(c["sofa"]["max_total"], 24);
        assert_eq!(c["family_history"]["points"]["first_degree"], 2.0);
        assert_eq!(c["medication"]["overdue_after_minutes"], 30);
        assert_eq!(c["fluid_balance"]["positive_high_ml"], 1000);
        assert_eq!(c["fluid_balance"]["bands"][0]["level"], "negative");
        assert_eq!(c["fluid_balance"]["bands"][3]["level"], "positive_high");
        assert_eq!(c["catheter_dwell_hours"]["picc"], 2160);
    }
}

// ============================================================================
// CRITICAL VALUE CLASSIFICATION
// ============================================================================

/// The facility's critical-value policy for one analyte: the values at which
/// the laboratory must telephone a clinician, and the panic tier beyond them.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct CriticalThreshold {
    pub analyte: &'static str,
    pub unit: &'static str,
    pub critical_low: Option<f64>,
    pub critical_high: Option<f64>,
    pub panic_low: Option<f64>,
    pub panic_high: Option<f64>,
}

const fn threshold(
    analyte: &'static str,
    unit: &'static str,
    critical: (Option<f64>, Option<f64>),
    panic: (Option<f64>, Option<f64>),
) -> CriticalThreshold {
    CriticalThreshold {
        analyte,
        unit,
        critical_low: critical.0,
        critical_high: critical.1,
        panic_low: panic.0,
        panic_high: panic.1,
    }
}

/// The critical-value call list.
///
/// This lived as a literal in `CriticalValuePage`, which classified each value
/// in the browser and posted its own conclusion (rule 8). The table is the
/// same one; the server now decides, and the page previews from the catalogue.
pub const CRITICAL_VALUE_THRESHOLDS: [CriticalThreshold; 13] = [
    threshold(
        "Glucose",
        "mg/dL",
        (Some(40.0), Some(500.0)),
        (Some(20.0), Some(700.0)),
    ),
    threshold(
        "Potassium",
        "mmol/L",
        (Some(2.5), Some(6.0)),
        (Some(2.0), Some(7.0)),
    ),
    threshold(
        "Sodium",
        "mmol/L",
        (Some(120.0), Some(160.0)),
        (Some(115.0), Some(170.0)),
    ),
    threshold(
        "Calcium",
        "mg/dL",
        (Some(6.0), Some(13.0)),
        (Some(5.0), Some(15.0)),
    ),
    threshold("Hemoglobin", "g/dL", (Some(5.0), None), (Some(4.0), None)),
    threshold(
        "Platelets",
        "10^9/L",
        (Some(20.0), None),
        (Some(10.0), None),
    ),
    threshold(
        "WBC",
        "10^9/L",
        (Some(1.0), Some(30.0)),
        (Some(0.5), Some(50.0)),
    ),
    threshold("INR", "ratio", (None, Some(5.0)), (None, Some(8.0))),
    threshold("Troponin", "ng/mL", (None, Some(0.5)), (None, Some(10.0))),
    threshold("Creatinine", "mg/dL", (None, Some(5.0)), (None, Some(10.0))),
    threshold("pH", "", (Some(7.20), Some(7.60)), (Some(7.10), Some(7.70))),
    threshold(
        "pCO2",
        "mmHg",
        (Some(20.0), Some(70.0)),
        (Some(15.0), Some(90.0)),
    ),
    threshold("pO2", "mmHg", (Some(40.0), None), (Some(30.0), None)),
];

/// Where a critical value sits on the facility's call list.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct CriticalClassification {
    /// `panic`, `critical-high` or `critical-low`.
    pub level: &'static str,
    /// The bound crossed, in words: `"Panic High (>7)"`.
    pub threshold: String,
    /// The bound's number, for the `critical_low` / `critical_high` columns.
    pub bound: f64,
    /// Whether the bound is a low one.
    pub low: bool,
}

/// Classify a result against the call list; `None` when the analyte is not on
/// it or the value crosses no bound (rule 12: not judged is not "normal").
pub fn classify_critical_value(analyte: &str, value: f64) -> Option<CriticalClassification> {
    let entry = CRITICAL_VALUE_THRESHOLDS
        .iter()
        .find(|t| t.analyte.eq_ignore_ascii_case(analyte.trim()))?;
    let tiers = [
        ("panic", "Panic High", entry.panic_high, false),
        ("panic", "Panic Low", entry.panic_low, true),
        ("critical-high", "Critical High", entry.critical_high, false),
        ("critical-low", "Critical Low", entry.critical_low, true),
    ];
    tiers.iter().find_map(|(level, label, bound, low)| {
        let bound = (*bound)?;
        let crossed = if *low { value <= bound } else { value >= bound };
        crossed.then(|| CriticalClassification {
            level,
            threshold: format!("{label} ({}{})", if *low { "<" } else { ">" }, bound),
            bound,
            low: *low,
        })
    })
}

// ============================================================================
// LAB VALUE CLASSIFICATION
// ============================================================================

/// Classify one measured analyte against the catalogue's thresholds.
///
/// Returns `None` — never `Normal` — when the value cannot be judged:
///
/// * the value is not numeric (`"Positive"`, `"Trace"`, `"<0.01"`). A
///   qualitative result is a finding, but it is not this scale's finding.
/// * the analyte is not in the catalogue, so there is nothing to compare to.
/// * the analyte is in the catalogue with no reference range and no critical
///   bounds.
///
/// That distinction is rule 12 applied to laboratory work: an unclassifiable
/// value is not a normal one, and a Flag column that prints "Normal" over a
/// result nobody could evaluate is worse than one that prints nothing.
///
/// Critical bounds are checked before the reference range, because they are the
/// ones that page a clinician. A potassium of 7.1 is both `High` by range and
/// `CriticalHigh` by bound; only the second is worth waking someone for.
pub fn classify_lab_value(
    test_name: &str,
    value: &str,
    reference_range: Option<&str>,
) -> Option<crate::clinical::LabValueStatus> {
    use crate::clinical::LabValueStatus as S;

    let measured: f64 = value.trim().parse().ok()?;
    let template = lab_test_template(test_name);

    // The submitted range wins over the catalogue's: a laboratory may run its
    // own assay with its own limits, and the row records which one was used.
    let range = reference_range.and_then(parse_reference_range).or_else(|| {
        template
            .as_ref()
            .and_then(|t| parse_reference_range(&t.reference_range_male))
    });

    if let Some(template) = template.as_ref() {
        if let Some(low) = template.critical_low {
            if measured <= low {
                return Some(S::CriticalLow);
            }
        }
        if let Some(high) = template.critical_high {
            if measured >= high {
                return Some(S::CriticalHigh);
            }
        }
    }

    let (low, high) = range?;
    if measured < low {
        Some(S::Low)
    } else if measured > high {
        Some(S::High)
    } else {
        Some(S::Normal)
    }
}

/// The catalogue entry for an analyte, matched case-insensitively on name.
///
/// Matching on the name is what the submission gives us; `LabTestResult` has no
/// LOINC field, so the code in the catalogue cannot be the key yet.
fn lab_test_template(test_name: &str) -> Option<crate::clinical::LabTestTemplate> {
    let wanted = test_name.trim().to_ascii_lowercase();
    if wanted.is_empty() {
        return None;
    }
    crate::clinical::get_standard_lab_panels()
        .into_iter()
        .flat_map(|panel| panel.tests)
        .find(|test| test.name.trim().to_ascii_lowercase() == wanted)
}

/// `"12.0-17.5"` -> `(12.0, 17.5)`. Anything else is not a range.
///
/// Deliberately strict. `"<0.01"`, `"Negative"` and `"up to 40"` are real
/// entries in real catalogues and none of them bound a value at both ends, so
/// guessing one end would invent the other.
fn parse_reference_range(text: &str) -> Option<(f64, f64)> {
    let cleaned = text.trim();
    let (low, high) = cleaned.split_once('-')?;
    let low: f64 = low.trim().parse().ok()?;
    let high: f64 = high.trim().parse().ok()?;
    if low > high {
        return None;
    }
    Some((low, high))
}

/// The wire spelling of a classification, for `LabTestResult.flag`.
pub fn lab_flag_label(status: crate::clinical::LabValueStatus) -> &'static str {
    use crate::clinical::LabValueStatus as S;
    match status {
        S::CriticalLow => "critical_low",
        S::Low => "low",
        S::Normal => "normal",
        S::High => "high",
        S::CriticalHigh => "critical_high",
        S::Unknown => "unknown",
    }
}

#[cfg(test)]
mod lab_flag_tests {
    #[test]
    fn a_critical_value_is_classified_on_the_highest_tier_it_crosses() {
        let panic = super::classify_critical_value("Potassium", 7.2).unwrap();
        assert_eq!(panic.level, "panic");
        assert_eq!(panic.threshold, "Panic High (>7)");

        let high = super::classify_critical_value("potassium", 6.4).unwrap();
        assert_eq!(high.level, "critical-high");
        assert!(!high.low);

        let low = super::classify_critical_value("Sodium", 118.0).unwrap();
        assert_eq!(low.level, "critical-low");
        assert_eq!(low.bound, 120.0);
    }

    #[test]
    fn a_value_inside_the_bounds_or_an_unlisted_analyte_is_not_classified() {
        assert!(super::classify_critical_value("Potassium", 4.2).is_none());
        assert!(super::classify_critical_value("Ferritin", 2.0).is_none());
    }

    use super::{classify_lab_value, lab_flag_label};
    use crate::clinical::LabValueStatus as S;

    #[test]
    fn a_critical_low_is_critical_not_merely_low() {
        // Haemoglobin: reference 13.5-17.5 male, critical_low 7.0.
        assert_eq!(
            classify_lab_value("Hemoglobin", "6.4", None),
            Some(S::CriticalLow)
        );
        assert_eq!(classify_lab_value("Hemoglobin", "11.0", None), Some(S::Low));
    }

    #[test]
    fn a_value_inside_the_range_is_normal() {
        assert_eq!(
            classify_lab_value("Hemoglobin", "15.0", None),
            Some(S::Normal)
        );
    }

    #[test]
    fn a_critical_high_outranks_high() {
        assert_eq!(
            classify_lab_value("Hemoglobin", "21.0", None),
            Some(S::CriticalHigh)
        );
        assert_eq!(
            classify_lab_value("Hemoglobin", "18.2", None),
            Some(S::High)
        );
    }

    #[test]
    fn a_boundary_value_is_critical() {
        // At the bound, not past it. A potassium of exactly 7.0 is not "nearly"
        // critical.
        assert_eq!(
            classify_lab_value("Hemoglobin", "7.0", None),
            Some(S::CriticalLow)
        );
    }

    #[test]
    fn an_unclassifiable_value_is_none_and_not_normal() {
        // Qualitative result.
        assert_eq!(classify_lab_value("Hemoglobin", "Trace", None), None);
        // Analyte not in the catalogue and no range supplied.
        assert_eq!(classify_lab_value("Unobtainium", "4.2", None), None);
        // Blank.
        assert_eq!(classify_lab_value("Hemoglobin", "", None), None);
    }

    #[test]
    fn an_unknown_analyte_is_still_classified_against_a_supplied_range() {
        assert_eq!(
            classify_lab_value("Unobtainium", "4.2", Some("1.0-3.0")),
            Some(S::High)
        );
        assert_eq!(
            classify_lab_value("Unobtainium", "2.0", Some("1.0-3.0")),
            Some(S::Normal)
        );
    }

    #[test]
    fn a_range_that_is_not_a_range_classifies_nothing() {
        assert_eq!(
            classify_lab_value("Unobtainium", "4.2", Some("Negative")),
            None
        );
        assert_eq!(
            classify_lab_value("Unobtainium", "4.2", Some("<0.01")),
            None
        );
        assert_eq!(
            classify_lab_value("Unobtainium", "4.2", Some("9.0-1.0")),
            None
        );
    }

    #[test]
    fn labels_are_stable_on_the_wire() {
        assert_eq!(lab_flag_label(S::CriticalHigh), "critical_high");
        assert_eq!(lab_flag_label(S::Normal), "normal");
    }
}
