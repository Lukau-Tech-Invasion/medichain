pub use super::*;
use chrono::{DateTime, NaiveDate};
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
/// The published cut-points are 0–24 low, 25–44 moderate, 45+ high. Kept in one
/// place because the band is what actually drives the interventions — bed
/// alarm, hourly rounding, signage — and two copies of a threshold eventually
/// disagree about a patient sitting on the boundary.
pub(crate) fn morse_risk_band(total_score: i32) -> &'static str {
    if total_score >= 45 {
        "high"
    } else if total_score >= 25 {
        "moderate"
    } else {
        "low"
    }
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

/// Add a fluid event to the patient's intake/output record for today's shift,
/// creating it if absent, and keep the stored totals consistent with it.
///
/// Same history as [`append_mar_administration`]: the two "record fluid"
/// endpoints acknowledged without persisting, so a refetch never showed the
/// entry. Fluid balance drives real clinical decisions, so the running totals
/// are recomputed here rather than left to the caller.
pub(crate) async fn append_io_event(
    data: &web::Data<AppState>,
    patient_id: &str,
    shift: &str,
    recorded_by: &str,
    category: &str,
    amount_ml: i32,
) -> Result<String, crate::repositories::traits::RepositoryError> {
    let today = Utc::now().date_naive();
    let now = Utc::now();
    let event = serde_json::json!({
        "category": category,
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

    // Route the amount to its column. Unknown categories are still recorded as
    // an event and counted as "other" rather than silently dropped — losing a
    // documented fluid volume is worse than filing it imprecisely.
    let bump = |slot: &mut Option<i32>| *slot = Some(slot.unwrap_or(0) + amount_ml);
    let is_output = match category {
        "oral" | "oral_intake" => {
            bump(&mut entity.oral_intake);
            false
        }
        "iv" | "iv_intake" => {
            bump(&mut entity.iv_intake);
            false
        }
        "tube" | "tube_feeding" => {
            bump(&mut entity.tube_feeding);
            false
        }
        "urine" | "urine_output" => {
            bump(&mut entity.urine_output);
            true
        }
        "emesis" => {
            bump(&mut entity.emesis);
            true
        }
        "drainage" => {
            bump(&mut entity.drainage);
            true
        }
        "stool" => {
            bump(&mut entity.stool);
            true
        }
        "output" | "other_output" => {
            bump(&mut entity.other_output);
            true
        }
        _ => {
            bump(&mut entity.other_intake);
            false
        }
    };

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

fn parse_date_or_today(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap_or_else(|_| Utc::now().date_naive())
}

fn timestamp_to_datetime(value: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(value, 0).unwrap_or_else(Utc::now)
}

fn timestamp_to_date(value: i64) -> NaiveDate {
    timestamp_to_datetime(value).date_naive()
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

fn cardiac_entity(event: &CardiacEvent, data: Value) -> CardiacEventEntity {
    let now = Utc::now();
    CardiacEventEntity {
        id: event.event_id.clone(),
        patient_id: event.patient_id.clone(),
        event_type: json_label(&event.event_type),
        cath_lab_activated: event.cath_lab_activated,
        pci_performed: event.pci_performed,
        door_to_balloon_minutes: event.door_to_balloon_minutes,
        documented_by: event.documented_by.clone(),
        documented_at: event.documented_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn sepsis_entity(assessment: &SepsisAssessment, data: Value) -> SepsisAssessmentEntity {
    let now = Utc::now();
    SepsisAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        severity: json_label(&assessment.severity),
        suspected_source: assessment.suspected_source.clone(),
        qsofa_score: assessment.qsofa.score(),
        sofa_score: assessment.sofa_score,
        vasopressors_required: assessment.vasopressors_required,
        icu_admission: assessment.icu_admission,
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

fn medication_record_entity(
    id: String,
    record: &MedicationAdministrationRecord,
    documented_by: String,
    data: Value,
) -> MedicationRecordEntity {
    let now = Utc::now();
    MedicationRecordEntity {
        id,
        patient_id: record.patient_id.clone(),
        record_date: parse_date_or_today(&record.date),
        scheduled_medications: json_value(&record.scheduled_medications),
        prn_medications: json_value(&record.prn_medications),
        infusions: json_value(&record.infusions),
        completion_status: None,
        completion_percentage: None,
        primary_nurse: Some(documented_by),
        created_at: now,
        updated_at: now,
        facility_id: None,
        is_active: true,
        data,
    }
}

fn iv_assessment_entity(assessment: &IVSiteAssessment, data: Value) -> IVAssessmentEntity {
    let now = Utc::now();
    IVAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        site_id: assessment.line_id.clone(),
        site_location: assessment.insertion_site.clone(),
        catheter_type: Some(json_label(&assessment.line_type)),
        catheter_gauge: Some(assessment.catheter_size.clone()),
        insertion_date: Some(timestamp_to_date(assessment.insertion_time)),
        patency: None,
        site_appearance: assessment.site_assessment.notes.clone(),
        infiltration_grade: None,
        phlebitis_grade: assessment.site_assessment.vip_score.map(i32::from),
        current_infusions: Some(json_value(&assessment.current_infusions)),
        dressing_intact: Some(assessment.site_assessment.dressing_intact),
        dressing_change_due: NaiveDate::parse_from_str(&assessment.dressing_date, "%Y-%m-%d").ok(),
        pain_level: None,
        notes: assessment.site_assessment.notes.clone(),
        actions_taken: None,
        site_discontinued: Some(false),
        discontinuation_reason: None,
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: timestamp_to_datetime(assessment.assessed_at),
        created_at: now,
        updated_at: now,
        facility_id: None,
        data,
    }
}

fn shift_handoff_entity(handoff: &ShiftHandoff, data: Value) -> ShiftHandoffEntity {
    let now = Utc::now();
    ShiftHandoffEntity {
        id: handoff.handoff_id.clone(),
        patient_id: handoff.patient_id.clone(),
        outgoing_provider_id: handoff.from_nurse.clone(),
        incoming_provider_id: handoff.to_nurse.clone(),
        handoff_datetime: timestamp_to_datetime(handoff.handoff_time),
        handoff_type: "shift".to_string(),
        location_from: Some(handoff.situation.room_bed.clone()),
        location_to: None,
        situation: json_value(&handoff.situation).to_string(),
        background: json_value(&handoff.background).to_string(),
        assessment: json_value(&handoff.assessment).to_string(),
        recommendation: json_value(&handoff.recommendation).to_string(),
        pending_tasks: json_value(&handoff.pending_tasks),
        pending_results: Some(json_value(&handoff.assessment.pending_labs)),
        pending_consults: None,
        critical_values: None,
        code_status: Some(handoff.situation.code_status.clone()),
        isolation_precautions: handoff.situation.isolation.as_ref().map(json_value),
        fall_risk_level: Some(handoff.safety_checks.fall_risk_level.clone()),
        skin_integrity_issues: None,
        iv_access: Some(json_value(&handoff.assessment.iv_access)),
        drains_tubes: None,
        family_concerns: handoff.recommendation.family_concerns.clone(),
        anticipated_disposition: handoff.recommendation.expected_discharge.clone(),
        contingency_plans: Some(json_value(&handoff.recommendation.watch_for).to_string()),
        questions_asked: handoff.questions.as_ref().map(json_value),
        read_back_confirmed: handoff.acknowledged,
        acknowledged_by_incoming: handoff.acknowledged,
        acknowledged_at: handoff.acknowledged.then_some(now),
        handoff_tool_used: Some("SBAR".to_string()),
        created_at: now,
        updated_at: now,
        data,
    }
}
