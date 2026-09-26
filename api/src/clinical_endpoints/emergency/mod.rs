pub use super::*;
use chrono::DateTime;
use serde_json::Value;

mod assessments;
mod crisis;
mod management;

pub use assessments::*;
pub use crisis::*;
pub use management::*;

fn json_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or_default()
}

/// Morse Fall Scale risk band for a total score.
///
/// The published cut-points are 0-24 low, 25-44 moderate, 45+ high. This used
/// to hold its own copy of them, under a doc comment observing that "two copies
/// of a threshold eventually disagree about a patient sitting on the boundary"
/// — which was true, and by then there were three: this one, the generated
/// `risk_level` column in `fall_risk_assessments`, and `getRiskLevel` in
/// `FallRiskPage.tsx`.
///
/// The authority is now [`crate::clinical_scoring::morse_band`], which also
/// publishes the cut-points through `GET /api/clinical/scoring/catalog` so the
/// page can show a live band without a fourth copy. Kept as a name because it
/// reads better at the call site than the fully qualified path.
pub(crate) fn morse_risk_band(total_score: i32) -> &'static str {
    crate::clinical_scoring::morse_band(total_score)
}

/// Append a dose administration to the patient's MAR for today, creating the
/// day's record if this is the first dose recorded.
///
/// Previously `/api/emergency/administer-med` and `/api/nursing/mar/administer`
/// both returned `{"success": true}` without writing anything, so a nurse could
/// mark a dose given, see it confirmed, and leave no record of it — the next
/// nurse reading the MAR would see the dose as outstanding. A medication
/// administration record is a patient-safety artifact; both endpoints now share
/// this one writer so they cannot drift apart again.
///
/// Returns the MAR record id the administration was appended to.
pub(crate) async fn append_mar_administration(
    data: &web::Data<AppState>,
    patient_id: &str,
    administered_by: &str,
    administration: Value,
) -> Result<String, crate::repositories::traits::RepositoryError> {
    let today = Utc::now().date_naive();
    let existing = data
        .repositories
        .medication_records
        .get_by_patient_and_date(patient_id, today)
        .await?;

    match existing {
        Some(mut entity) => {
            push_into_array(&mut entity.data, "administrations", administration);
            entity.updated_at = Utc::now();
            let id = entity.id.clone();
            data.repositories.medication_records.update(entity).await?;
            Ok(id)
        }
        None => {
            let id = format!("MAR-{}-{}", patient_id, today);
            let now = Utc::now();
            let entity = crate::repositories::traits::MedicationRecordEntity {
                id: id.clone(),
                patient_id: patient_id.to_string(),
                record_date: today,
                scheduled_medications: Value::Array(vec![]),
                prn_medications: Value::Array(vec![]),
                infusions: Value::Array(vec![]),
                completion_status: None,
                completion_percentage: None,
                primary_nurse: Some(administered_by.to_string()),
                created_at: now,
                updated_at: now,
                facility_id: None,
                is_active: true,
                data: serde_json::json!({ "administrations": [administration] }),
            };
            data.repositories.medication_records.create(entity).await?;
            Ok(id)
        }
    }
}

/// One fluid a nurse charted.
///
/// A struct rather than seven positional arguments, and the reason is the bug
/// this replaced. Three screens post fluids and each named the field
/// differently, so every caller did its own normalising before calling in —
/// `IntakeOutputPage` sent `"output:urine"` because a comment here said
/// categories were "stored prefixed by direction so intake and output cannot be
/// confused", while the routing table below matched bare names and understood
/// no prefix at all. Both prefixed categories and unrecognised fluid names fell
/// through to the same `_` arm and were counted as **intake**.
///
/// The consequence is not a display detail. Charting 800 mL of urine moved the
/// running balance by +800 instead of −800: a 1600 mL error, in the wrong
/// direction, on the number a clinician titrates fluids and diuretics against.
///
/// So direction is now an explicit field that this function resolves, once,
/// instead of a convention each caller re-invents.
pub(crate) struct FluidEvent<'a> {
    pub patient_id: &'a str,
    pub shift: &'a str,
    pub recorded_by: &'a str,
    /// The fluid, as a bare canonical name (`oral`, `iv`, `urine`, `emesis`,
    /// `drainage`, `stool`). Never direction-prefixed.
    pub category: &'a str,
    /// `intake` or `output`, for a fluid whose name does not imply one. Ignored
    /// when the category is recognised, because `urine` is an output no matter
    /// what a caller claims.
    pub direction: Option<&'a str>,
    /// What the nurse actually called it, kept for the chart even when the
    /// totals had to bucket it as "other": "wound drain" and "chest drain" are
    /// both drainage to the arithmetic and different things to the reader.
    pub label: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub amount_ml: i32,
}

/// Which column a fluid belongs in, and whether it is an output.
///
/// Returns `None` for a fluid this table does not recognise, so the caller can
/// fall back to the stated direction rather than silently choosing intake.
fn fluid_bucket(category: &str) -> Option<(&'static str, bool)> {
    match category {
        "oral" | "oral_intake" => Some(("oral_intake", false)),
        "iv" | "iv_intake" => Some(("iv_intake", false)),
        "tube" | "tube_feeding" => Some(("tube_feeding", false)),
        "urine" | "urine_output" => Some(("urine_output", true)),
        "emesis" => Some(("emesis", true)),
        "drainage" => Some(("drainage", true)),
        "stool" => Some(("stool", true)),
        "output" | "other_output" => Some(("other_output", true)),
        "other" | "other_intake" => Some(("other_intake", false)),
        _ => None,
    }
}

/// Add a fluid event to the patient's intake/output record for today's shift,
/// creating it if absent, and keep the stored totals consistent with it.
///
/// Same history as [`append_mar_administration`]: the two "record fluid"
/// endpoints acknowledged without persisting, so a refetch never showed the
/// entry. Fluid balance drives real clinical decisions, so the running totals
/// are recomputed here rather than left to the caller.
pub(crate) async fn append_io_event(
    data: &web::Data<AppState>,
    fluid: FluidEvent<'_>,
) -> Result<String, crate::repositories::traits::RepositoryError> {
    let FluidEvent {
        patient_id,
        shift,
        recorded_by,
        category,
        direction,
        label,
        notes,
        amount_ml,
    } = fluid;

    // Strip a legacy `intake:`/`output:` prefix rather than failing to match it.
    // Stored records and older callers use that form, and treating it as an
    // unknown fluid is exactly the bug this function is being fixed for.
    let (prefix, bare) = match category.split_once(':') {
        Some((d, c)) if matches!(d, "intake" | "output") => (Some(d), c),
        _ => (None, category),
    };
    let stated = direction.or(prefix);

    let today = Utc::now().date_naive();
    let now = Utc::now();
    let event = serde_json::json!({
        "category": bare,
        "label": label,
        "notes": notes,
        "amount_ml": amount_ml,
        "recorded_by": recorded_by,
        "recorded_at": now.to_rfc3339(),
    });

    let existing = data
        .repositories
        .io_records
        .get_by_patient_date_shift(patient_id, today, shift)
        .await?;

    let mut entity = match existing {
        Some(e) => e,
        None => {
            let id = format!("IO-{}-{}-{}", patient_id, today, shift);
            crate::repositories::traits::IORecordEntity {
                id,
                patient_id: patient_id.to_string(),
                record_date: today,
                shift: shift.to_string(),
                oral_intake: Some(0),
                iv_intake: Some(0),
                tube_feeding: Some(0),
                other_intake: Some(0),
                total_intake: 0,
                urine_output: Some(0),
                emesis: Some(0),
                drainage: Some(0),
                stool: Some(0),
                other_output: Some(0),
                total_output: 0,
                net_balance: 0,
                intake_items: Some(Value::Array(vec![])),
                output_items: Some(Value::Array(vec![])),
                notes: None,
                recorded_by: recorded_by.to_string(),
                verified_by: None,
                created_at: now,
                updated_at: now,
                facility_id: None,
                data: serde_json::json!({ "events": [] }),
            }
        }
    };

    // Route the amount to its column. An unrecognised fluid is still recorded
    // and still counted — losing a documented volume is worse than filing it
    // imprecisely — but it is counted in the direction the nurse stated, not
    // assumed to be intake.
    let bump = |slot: &mut Option<i32>| *slot = Some(slot.unwrap_or(0) + amount_ml);
    let (column, is_output) = match fluid_bucket(bare) {
        Some(known) => known,
        // The fluid is not in the table. The direction the caller stated is
        // then the only thing that decides the sign of the balance, and
        // defaulting it to intake is how urine came to be counted as intake.
        None if stated == Some("output") => ("other_output", true),
        None => ("other_intake", false),
    };
    match column {
        "oral_intake" => bump(&mut entity.oral_intake),
        "iv_intake" => bump(&mut entity.iv_intake),
        "tube_feeding" => bump(&mut entity.tube_feeding),
        "urine_output" => bump(&mut entity.urine_output),
        "emesis" => bump(&mut entity.emesis),
        "drainage" => bump(&mut entity.drainage),
        "stool" => bump(&mut entity.stool),
        "other_output" => bump(&mut entity.other_output),
        _ => bump(&mut entity.other_intake),
    }

    entity.total_intake = entity.oral_intake.unwrap_or(0)
        + entity.iv_intake.unwrap_or(0)
        + entity.tube_feeding.unwrap_or(0)
        + entity.other_intake.unwrap_or(0);
    entity.total_output = entity.urine_output.unwrap_or(0)
        + entity.emesis.unwrap_or(0)
        + entity.drainage.unwrap_or(0)
        + entity.stool.unwrap_or(0)
        + entity.other_output.unwrap_or(0);
    entity.net_balance = entity.total_intake - entity.total_output;

    let items = if is_output {
        &mut entity.output_items
    } else {
        &mut entity.intake_items
    };
    let mut list = items.take().unwrap_or_else(|| Value::Array(vec![]));
    if let Value::Array(arr) = &mut list {
        arr.push(event.clone());
    }
    *items = Some(list);
    push_into_array(&mut entity.data, "events", event);
    entity.updated_at = now;

    let id = entity.id.clone();
    let is_new = data
        .repositories
        .io_records
        .get_by_id(&id)
        .await
        .ok()
        .is_none();
    if is_new {
        data.repositories.io_records.create(entity).await?;
    } else {
        data.repositories.io_records.update(entity).await?;
    }
    Ok(id)
}

/// Push `item` onto `blob[key]`, creating the array if the key is absent.
fn push_into_array(blob: &mut Value, key: &str, item: Value) {
    if !blob.is_object() {
        *blob = serde_json::json!({});
    }
    let obj = match blob.as_object_mut() {
        Some(o) => o,
        None => return,
    };
    match obj.get_mut(key).and_then(|v| v.as_array_mut()) {
        Some(arr) => arr.push(item),
        None => {
            obj.insert(key.to_string(), Value::Array(vec![item]));
        }
    }
}

/// Provider-or-self gate for the per-type emergency list-by-patient endpoints.
///
/// Mirrors the check on `list_patient_code_blues` (HZ-020): a healthcare
/// provider, or the patient reading their own records. Returns the canonical
/// 401/403 response otherwise.
fn require_emergency_list_access(
    data: &web::Data<AppState>,
    http_req: &HttpRequest,
    patient_id: &str,
) -> Result<(), HttpResponse> {
    let current_user_id = match get_current_user_id(http_req) {
        Some(id) => id,
        None => return Err(HttpResponse::Unauthorized().finish()),
    };
    match get_user(data, &current_user_id) {
        Some(u)
            if u.role.is_healthcare_provider()
                || crate::support::caller_owns_patient_record(
                    data,
                    &current_user_id,
                    patient_id,
                ) =>
        {
            Ok(())
        }
        Some(_) => Err(HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        })),
        None => Err(HttpResponse::Unauthorized().finish()),
    }
}

fn access_log_entity(
    accessor_id: String,
    accessor_role: &str,
    action: &str,
    patient_id: Option<String>,
) -> AccessLogEntity {
    AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id,
        accessor_role: accessor_role.to_string(),
        patient_id,
        resource_type: "emergency_record".to_string(),
        resource_id: None,
        action: action.to_string(),
        access_reason: Some("emergency workflow".to_string()),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: Utc::now(),
        facility_id: None,
        authority_type: None,
        authority_id: None,
    }
}

fn code_blue_entity(
    record: &crate::clinical_endpoints::CreateCodeBlueRequest,
    data: Value,
) -> CodeBlueEntity {
    let now = Utc::now();
    CodeBlueEntity {
        id: record.event_id.clone(),
        patient_id: record.patient_id.clone(),
        location: blank_to_none(record.location.as_deref()),
        code_called_at: record.code_called_at,
        team_arrived_at: record.team_arrived_at,
        // Not asked for by any screen. `None`, not `""`.
        initial_rhythm: blank_to_none(record.initial_rhythm.as_deref()),
        witnessed: record.witnessed,
        outcome: record.outcome.clone(),
        code_leader: blank_to_none(record.code_leader.as_deref()),
        // The page sends who called the code; that is who is documenting it.
        documented_by: record.code_called_by.clone(),
        documented_at: record.code_called_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

/// `Some(text)` only when there is text. A form that submits an untouched
/// optional field sends `""`, and `""` stored in a clinical column reads as a
/// recorded blank rather than as "not asked".
fn blank_to_none(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn trauma_entity(
    assessment: &crate::clinical_endpoints::CreateTraumaRequest,
    data: Value,
) -> TraumaAssessmentEntity {
    let now = Utc::now();
    TraumaAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        mechanism: assessment.mechanism_of_injury.clone(),
        gcs: assessment.gcs_score,
        // Trauma level, massive-transfusion activation and disposition are
        // decided downstream of this form; `TraumaPage` has no input for any
        // of them.
        trauma_level: None,
        mtp_activated: None,
        disposition: None,
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: assessment.assessed_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn stroke_entity(
    assessment: &crate::clinical_endpoints::CreateStrokeRequest,
    data: Value,
) -> StrokeAssessmentEntity {
    let now = Utc::now();
    StrokeAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        nihss_total: assessment.nihss_score,
        // Classification, haemorrhage, LVO and whether tPA was given are all
        // decided after this screen. The form records eligibility as a
        // three-way clinical judgement (`eligible` / `not_eligible` /
        // `evaluating`), so only an explicit answer becomes a boolean --
        // "still evaluating" is not "not eligible".
        stroke_type: None,
        tpa_eligible: match assessment.tpa_eligibility.as_deref() {
            Some("eligible") | Some("yes") | Some("true") => Some(true),
            Some("not_eligible") | Some("ineligible") | Some("no") | Some("false") => Some(false),
            _ => None,
        },
        tpa_given: None,
        hemorrhage: None,
        lvo_suspected: None,
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: assessment.assessed_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

/// One set of observations the crew recorded. Every reading is optional; a set
/// with none of them is refused, not stored as a row of blanks.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct EmsVitalsRequest {
    #[serde(default)]
    pub taken_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub systolic_bp: Option<u16>,
    #[serde(default)]
    pub diastolic_bp: Option<u16>,
    #[serde(default)]
    pub heart_rate: Option<u16>,
    #[serde(default)]
    pub respiratory_rate: Option<u16>,
    #[serde(default)]
    pub spo2: Option<u8>,
    #[serde(default)]
    pub temperature_c: Option<f32>,
    #[serde(default)]
    pub glucose_mmol: Option<f32>,
}

impl EmsVitalsRequest {
    fn measured_anything(&self) -> bool {
        self.systolic_bp.is_some()
            || self.diastolic_bp.is_some()
            || self.heart_rate.is_some()
            || self.respiratory_rate.is_some()
            || self.spo2.is_some()
            || self.temperature_c.is_some()
            || self.glucose_mmol.is_some()
    }
}

/// A drug the crew gave before arrival.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct EmsMedicationRequest {
    pub name: String,
    #[serde(default)]
    pub dose: Option<String>,
    #[serde(default)]
    pub route: Option<String>,
    #[serde(default)]
    pub given_at: Option<DateTime<Utc>>,
}

/// SAMPLE history as the crew took it. Free text: it is what the patient or a
/// bystander said, not a coded record.
#[derive(Debug, Clone, Default, Deserialize, serde::Serialize)]
pub struct EmsSampleRequest {
    #[serde(default)]
    pub signs_symptoms: Option<String>,
    #[serde(default)]
    pub allergies: Option<String>,
    #[serde(default)]
    pub medications: Option<String>,
    #[serde(default)]
    pub past_history: Option<String>,
    #[serde(default)]
    pub last_intake: Option<String>,
    #[serde(default)]
    pub events: Option<String>,
}

/// An ambulance crew's handover to the emergency department, as the receiving
/// clinician records it.
///
/// This replaced the `EMSHandoff` domain type on the wire (rule 11): 30
/// required fields, so a screen that collected a dozen could not save at all --
/// and none did, because there was no screen. It also took the record's id
/// from the body, so a second handover could overwrite the first. The id, the
/// receiving clinician and the handover time are the server's.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateEmsHandoffRequest {
    /// The patient, when identified -- by their card, or by name at the door.
    #[serde(default)]
    pub patient_id: Option<String>,
    pub ems_agency: String,
    #[serde(default)]
    pub unit_number: Option<String>,
    #[serde(default)]
    pub crew: Vec<String>,
    #[serde(default)]
    pub incident_type: Option<String>,
    #[serde(default)]
    pub scene_address: Option<String>,
    #[serde(default)]
    pub dispatch_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub on_scene_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub departed_scene_time: Option<DateTime<Utc>>,
    pub chief_complaint: String,
    #[serde(default)]
    pub mechanism_of_injury: Option<String>,
    #[serde(default)]
    pub gcs_on_scene: Option<u8>,
    #[serde(default)]
    pub vital_signs: Vec<EmsVitalsRequest>,
    #[serde(default)]
    pub interventions: Vec<String>,
    #[serde(default)]
    pub medications_given: Vec<EmsMedicationRequest>,
    #[serde(default)]
    pub sample: Option<EmsSampleRequest>,
    #[serde(default)]
    pub trauma_alert: bool,
    #[serde(default)]
    pub stroke_alert: bool,
    #[serde(default)]
    pub stemi_alert: bool,
    #[serde(default)]
    pub sepsis_alert: bool,
    #[serde(default)]
    pub notes: Option<String>,
}

impl CreateEmsHandoffRequest {
    /// Why this handover cannot be stored, if it cannot.
    fn problem(&self) -> Option<String> {
        if self.ems_agency.trim().is_empty() {
            return Some("ems_agency is required: who brought the patient in".to_string());
        }
        if self.chief_complaint.trim().is_empty() {
            return Some("chief_complaint is required".to_string());
        }
        if let Some(gcs) = self.gcs_on_scene {
            if !(3..=15).contains(&gcs) {
                return Some("gcs_on_scene must be between 3 and 15".to_string());
            }
        }
        if self.vital_signs.iter().any(|v| !v.measured_anything()) {
            return Some("a set of vital signs must record at least one reading".to_string());
        }
        if self.vital_signs.iter().any(|v| {
            matches!((v.systolic_bp, v.diastolic_bp), (Some(s), Some(d)) if crate::clinical_scoring::blood_pressure_is_transposed(s, d))
        }) {
            return Some("a blood pressure's systolic must be above its diastolic".to_string());
        }
        // The times the crew recorded must run in order.
        let times = [
            self.dispatch_time,
            self.on_scene_time,
            self.departed_scene_time,
        ];
        let known: Vec<DateTime<Utc>> = times.iter().flatten().copied().collect();
        if known.windows(2).any(|w| w[0] > w[1]) {
            return Some("dispatch, on-scene and departure times must be in order".to_string());
        }
        None
    }
}

/// The stored row for a handover received now by `receiver`.
fn ems_handoff_entity(
    id: &str,
    request: &CreateEmsHandoffRequest,
    receiver: &str,
    now: DateTime<Utc>,
) -> EmsHandoffEntity {
    let text = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let mut data = serde_json::to_value(request).unwrap_or_default();
    if let Some(object) = data.as_object_mut() {
        object.insert("id".into(), serde_json::json!(id));
        object.insert("received_by".into(), serde_json::json!(receiver));
        object.insert("received_at".into(), serde_json::json!(now.to_rfc3339()));
    }
    EmsHandoffEntity {
        id: id.to_string(),
        patient_id: text(&request.patient_id),
        receiving_provider_id: receiver.to_string(),
        handoff_datetime: now,
        ems_agency: request.ems_agency.trim().to_string(),
        ems_unit_number: text(&request.unit_number),
        crew_members: serde_json::json!(request.crew),
        run_number: None,
        dispatch_time: request.dispatch_time,
        on_scene_time: request.on_scene_time,
        transport_start_time: request.departed_scene_time,
        // The handover happens on arrival; the record is made then.
        arrival_time: now,
        scene_address: text(&request.scene_address),
        incident_type: text(&request.incident_type),
        chief_complaint: request.chief_complaint.trim().to_string(),
        mechanism_of_injury: text(&request.mechanism_of_injury),
        patient_found: None,
        mental_status_on_scene: None,
        gcs_on_scene: request.gcs_on_scene.map(i32::from),
        vital_signs_on_scene: request.vital_signs.first().map(|v| serde_json::json!(v)),
        vital_signs_transport: Some(serde_json::json!(request.vital_signs)),
        vital_signs_arrival: request.vital_signs.last().map(|v| serde_json::json!(v)),
        interventions_performed: Some(serde_json::json!(request.interventions)),
        medications_given: Some(serde_json::json!(request.medications_given)),
        iv_access_obtained: false,
        iv_details: None,
        airway_management: None,
        cpr_performed: false,
        aed_used: false,
        shocks_delivered: None,
        spinal_immobilization: false,
        splinting_performed: false,
        tourniquet_applied: false,
        bleeding_controlled: None,
        patient_belongings: None,
        family_at_scene: false,
        family_contact_info: None,
        police_at_scene: false,
        police_report_number: None,
        trauma_alert: request.trauma_alert,
        stroke_alert: request.stroke_alert,
        stemi_alert: request.stemi_alert,
        sepsis_alert: request.sepsis_alert,
        report_received_by: Some(receiver.to_string()),
        report_received_time: Some(now),
        verbal_report_complete: true,
        ems_documentation_received: false,
        notes: text(&request.notes),
        created_at: now,
        updated_at: now,
        data,
    }
}
