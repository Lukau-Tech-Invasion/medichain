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
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        })),
        None => Err(HttpResponse::Unauthorized().finish()),
    }
}

fn json_label<T: serde::Serialize>(value: &T) -> String {
    match json_value(value) {
        Value::String(label) => label,
        other => other.to_string(),
    }
}

fn timestamp_to_datetime(value: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(value, 0).unwrap_or_else(Utc::now)
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
    }
}

fn code_blue_entity(record: &CodeBlueRecord, data: Value) -> CodeBlueEntity {
    let now = Utc::now();
    CodeBlueEntity {
        id: record.event_id.clone(),
        patient_id: record.patient_id.clone(),
        location: record.location.clone(),
        code_called_at: record.code_called_at,
        team_arrived_at: record.team_arrived_at,
        initial_rhythm: json_label(&record.initial_rhythm),
        witnessed: record.witnessed,
        outcome: json_label(&record.outcome),
        code_leader: record.code_leader.clone(),
        documented_by: record.documented_by.clone(),
        documented_at: record.documented_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn trauma_entity(assessment: &TraumaAssessment, data: Value) -> TraumaAssessmentEntity {
    let now = Utc::now();
    TraumaAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        mechanism: json_label(&assessment.mechanism),
        gcs: assessment.gcs,
        trauma_level: assessment.trauma_level,
        mtp_activated: assessment.mtp_activated,
        disposition: json_label(&assessment.disposition),
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: assessment.assessed_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn stroke_entity(assessment: &StrokeAssessment, data: Value) -> StrokeAssessmentEntity {
    let now = Utc::now();
    StrokeAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        nihss_total: assessment.nihss_total,
        stroke_type: json_label(&assessment.stroke_type),
        tpa_eligible: assessment.tpa_eligible,
        tpa_given: assessment.tpa_given,
        hemorrhage: assessment.hemorrhage,
        lvo_suspected: assessment.lvo_suspected,
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: assessment.assessed_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn ems_handoff_entity(handoff: &EMSHandoff, data: Value) -> EmsHandoffEntity {
    let now = Utc::now();
    EmsHandoffEntity {
        id: handoff.report_id.clone(),
        patient_id: handoff.patient_id.clone(),
        receiving_provider_id: handoff.receiving_physician.clone().unwrap_or_default(),
        handoff_datetime: timestamp_to_datetime(handoff.handoff_time),
        ems_agency: "EMS".to_string(),
        ems_unit_number: Some(handoff.unit_number.clone()),
        crew_members: json_value(&handoff.crew),
        run_number: None,
        dispatch_time: Some(timestamp_to_datetime(handoff.dispatch_time)),
        on_scene_time: Some(timestamp_to_datetime(handoff.on_scene_time)),
        transport_start_time: Some(timestamp_to_datetime(handoff.depart_scene_time)),
        arrival_time: timestamp_to_datetime(handoff.arrival_time),
        scene_address: Some(handoff.scene_location.clone()),
        incident_type: Some(handoff.dispatch_reason.clone()),
        chief_complaint: handoff.chief_complaint.clone(),
        mechanism_of_injury: handoff.mechanism.clone(),
        patient_found: None,
        mental_status_on_scene: None,
        gcs_on_scene: handoff.gcs.map(i32::from),
        vital_signs_on_scene: handoff.vital_signs.first().map(json_value),
        vital_signs_transport: Some(json_value(&handoff.vital_signs)),
        vital_signs_arrival: handoff.vital_signs.last().map(json_value),
        interventions_performed: Some(json_value(&handoff.interventions)),
        medications_given: Some(json_value(&handoff.medications)),
        iv_access_obtained: !handoff.iv_access.is_empty(),
        iv_details: Some(json_value(&handoff.iv_access)),
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
        trauma_alert: handoff.trauma_alert,
        stroke_alert: handoff.stroke_alert,
        stemi_alert: handoff.stemi_alert,
        sepsis_alert: false,
        report_received_by: handoff.receiving_physician.clone(),
        report_received_time: Some(timestamp_to_datetime(handoff.handoff_time)),
        verbal_report_complete: true,
        ems_documentation_received: false,
        notes: handoff.notes.clone(),
        created_at: now,
        updated_at: now,
        data,
    }
}
