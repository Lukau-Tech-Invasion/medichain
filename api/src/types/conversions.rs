use super::*;

impl From<AccessLogEntry> for crate::repositories::traits::AccessLogEntity {
    fn from(entry: AccessLogEntry) -> Self {
        Self {
            id: entry.access_id,
            accessor_id: entry.accessor_id,
            accessor_role: entry.accessor_role,
            patient_id: Some(entry.patient_id),
            resource_type: "patient_record".to_string(),
            resource_id: None,
            action: entry.access_type,
            access_reason: None,
            is_emergency_access: entry.emergency,
            ip_address: None,
            user_agent: None,
            blockchain_tx_hash: None,
            accessed_at: entry.timestamp,
            facility_id: entry.location,
        }
    }
}

impl From<crate::repositories::traits::AccessLogEntity> for AccessLogEntry {
    fn from(entity: crate::repositories::traits::AccessLogEntity) -> Self {
        Self {
            access_id: entity.id,
            patient_id: entity.patient_id.unwrap_or_default(),
            accessor_id: entity.accessor_id,
            accessor_role: entity.accessor_role,
            access_type: entity.action,
            location: entity.facility_id,
            timestamp: entity.accessed_at,
            emergency: entity.is_emergency_access,
        }
    }
}

impl From<NfcTagData> for crate::repositories::traits::NfcTagEntity {
    fn from(tag: NfcTagData) -> Self {
        Self {
            id: tag.tag_id,
            tag_uid: tag.hash,
            patient_id: tag.patient_id,
            tag_type: "emergency".to_string(),
            is_active: true,
            pin_hash: None,
            issued_at: tag.created_at,
            expires_at: None,
            last_used_at: None,
            use_count: 0,
            issued_by: None,
        }
    }
}

impl From<crate::repositories::traits::NfcTagEntity> for NfcTagData {
    fn from(entity: crate::repositories::traits::NfcTagEntity) -> Self {
        Self {
            tag_id: entity.id,
            patient_id: entity.patient_id,
            hash: entity.tag_uid,
            created_at: entity.issued_at,
        }
    }
}

impl From<(String, crate::ipfs::MedicalRecordReference)>
    for crate::repositories::traits::MedicalRecordEntity
{
    fn from((patient_id, r): (String, crate::ipfs::MedicalRecordReference)) -> Self {
        let record_date =
            DateTime::<Utc>::from_timestamp(r.uploaded_at, 0).unwrap_or_else(Utc::now);
        Self {
            id: format!("REC-{}", Uuid::new_v4()),
            patient_id,
            record_type: r.record_type,
            category: None,
            ipfs_content_hash: Some(r.content_hash),
            ipfs_metadata_hash: Some(r.metadata_hash),
            content_checksum: Some(r.content_checksum),
            on_chain_hash: None,
            blockchain_tx_hash: None,
            summary_encrypted: None,
            record_date,
            created_at: record_date,
            updated_at: record_date,
            created_by: String::new(),
            last_modified_by: String::new(),
            facility_id: None,
            is_active: true,
            is_locked: false,
        }
    }
}

impl From<crate::repositories::traits::MedicalRecordEntity>
    for crate::ipfs::MedicalRecordReference
{
    fn from(entity: crate::repositories::traits::MedicalRecordEntity) -> Self {
        Self {
            content_hash: entity.ipfs_content_hash.unwrap_or_default(),
            metadata_hash: entity.ipfs_metadata_hash.unwrap_or_default(),
            record_type: entity.record_type,
            uploaded_at: entity.record_date.timestamp(),
            content_checksum: entity.content_checksum.unwrap_or_default(),
        }
    }
}

impl From<(String, crate::clinical::VitalSignsReading)>
    for crate::repositories::traits::VitalSignsEntity
{
    fn from((patient_id, r): (String, crate::clinical::VitalSignsReading)) -> Self {
        let recorded_at = DateTime::<Utc>::from_timestamp(r.timestamp, 0).unwrap_or_else(Utc::now);
        let is_critical = !r.has_critical_values().is_empty();
        Self {
            id: r.reading_id,
            patient_id,
            heart_rate: r.heart_rate.map(|v| v as i32),
            respiratory_rate: r.respiratory_rate.map(|v| v as i32),
            blood_pressure_systolic: r.systolic_bp.map(|v| v as i32),
            blood_pressure_diastolic: r.diastolic_bp.map(|v| v as i32),
            mean_arterial_pressure: None,
            temperature: r.temperature_celsius.map(|v| v as f64),
            temperature_site: None,
            oxygen_saturation: r.oxygen_saturation.map(|v| v as i32),
            oxygen_delivery: None,
            fio2: None,
            pain_scale: r.pain_scale.map(|v| v as i32),
            gcs_score: None,
            gcs_eye: None,
            gcs_verbal: None,
            gcs_motor: None,
            blood_glucose: None,
            weight_kg: None,
            height_cm: None,
            bmi: None,
            position: None,
            activity_level: None,
            is_critical,
            critical_values: None,
            recorded_at,
            recorded_by: r.recorded_by,
            facility_id: None,
            created_at: recorded_at,
        }
    }
}

impl From<crate::repositories::traits::VitalSignsEntity> for crate::clinical::VitalSignsReading {
    fn from(e: crate::repositories::traits::VitalSignsEntity) -> Self {
        Self {
            reading_id: e.id,
            timestamp: e.recorded_at.timestamp(),
            heart_rate: e.heart_rate.map(|v| v as u16),
            systolic_bp: e.blood_pressure_systolic.map(|v| v as u16),
            diastolic_bp: e.blood_pressure_diastolic.map(|v| v as u16),
            respiratory_rate: e.respiratory_rate.map(|v| v as u16),
            oxygen_saturation: e.oxygen_saturation.map(|v| v as u16),
            temperature_celsius: e.temperature.map(|v| v as f32),
            pain_scale: e.pain_scale.map(|v| v as u8),
            recorded_by: e.recorded_by,
            notes: None,
        }
    }
}

// CDS Alert <-> CdsAlertEntity conversions
// Schema mismatch: legacy CDSAlert has structured fields (recommended_actions, evidence,
// clinical_context, expires_at, guideline_reference) the entity doesn't model directly.
// Strategy: pack extras into entity.trigger_data as a JSON object; serialize collections
// into entity.recommendation / entity.clinical_evidence as JSON strings. Round-trip safe.

pub fn cds_pack_extras(a: &crate::clinical::CDSAlert) -> serde_json::Value {
    serde_json::json!({
        "triggering_data": a.triggering_data,
        "clinical_context": a.clinical_context,
        "expires_at": a.expires_at,
        "guideline_reference": a.guideline_reference,
    })
}

pub fn cds_parse_action_taken(s: &str) -> crate::clinical::CDSActionTaken {
    match s {
        "Accepted" => crate::clinical::CDSActionTaken::Accepted,
        "AcceptedWithModification" => crate::clinical::CDSActionTaken::AcceptedWithModification,
        "Overridden" => crate::clinical::CDSActionTaken::Overridden,
        "Deferred" => crate::clinical::CDSActionTaken::Deferred,
        "EscalatedToPharmacy" => crate::clinical::CDSActionTaken::EscalatedToPharmacy,
        "PatientRefused" => crate::clinical::CDSActionTaken::PatientRefused,
        _ => crate::clinical::CDSActionTaken::NotApplicable,
    }
}

pub fn cds_parse_severity(s: &str) -> crate::clinical::CDSSeverity {
    match s.to_lowercase().as_str() {
        "informational" => crate::clinical::CDSSeverity::Informational,
        "low" => crate::clinical::CDSSeverity::Low,
        "medium" => crate::clinical::CDSSeverity::Medium,
        "high" => crate::clinical::CDSSeverity::High,
        "critical" => crate::clinical::CDSSeverity::Critical,
        _ => crate::clinical::CDSSeverity::Informational,
    }
}

pub fn cds_parse_status(s: &str) -> crate::clinical::CDSAlertStatus {
    match s.to_lowercase().as_str() {
        "active" => crate::clinical::CDSAlertStatus::Active,
        "acknowledged" => crate::clinical::CDSAlertStatus::Acknowledged,
        "accepted" => crate::clinical::CDSAlertStatus::Accepted,
        "overridden" => crate::clinical::CDSAlertStatus::Overridden,
        "deferred" => crate::clinical::CDSAlertStatus::Deferred,
        "resolved" => crate::clinical::CDSAlertStatus::Resolved,
        "expired" => crate::clinical::CDSAlertStatus::Expired,
        _ => crate::clinical::CDSAlertStatus::Active,
    }
}

pub fn cds_parse_alert_type(s: &str) -> crate::clinical::CDSAlertType {
    match s {
        "DrugInteraction" => crate::clinical::CDSAlertType::DrugInteraction,
        "DrugAllergy" => crate::clinical::CDSAlertType::DrugAllergy,
        "DuplicateTherapy" => crate::clinical::CDSAlertType::DuplicateTherapy,
        "DoseRangeCheck" => crate::clinical::CDSAlertType::DoseRangeCheck,
        "PreventiveCare" => crate::clinical::CDSAlertType::PreventiveCare,
        "DiagnosticGap" => crate::clinical::CDSAlertType::DiagnosticGap,
        "LaboratoryAbnormal" => crate::clinical::CDSAlertType::LaboratoryAbnormal,
        "VitalSignAbnormal" => crate::clinical::CDSAlertType::VitalSignAbnormal,
        "CarePlanDeviation" => crate::clinical::CDSAlertType::CarePlanDeviation,
        "QualityMeasure" => crate::clinical::CDSAlertType::QualityMeasure,
        "CostSavingOpportunity" => crate::clinical::CDSAlertType::CostSavingOpportunity,
        "OrderSet" => crate::clinical::CDSAlertType::OrderSet,
        _ => crate::clinical::CDSAlertType::BestPracticeAdvisory,
    }
}

impl From<crate::clinical::CDSAlert> for crate::repositories::traits::CdsAlertEntity {
    fn from(a: crate::clinical::CDSAlert) -> Self {
        let created_at = DateTime::<Utc>::from_timestamp(a.created_at, 0).unwrap_or_else(Utc::now);
        let extras = cds_pack_extras(&a);
        let recommendation = (!a.recommended_actions.is_empty())
            .then(|| serde_json::to_string(&a.recommended_actions).unwrap_or_default());
        let clinical_evidence = (!a.evidence.is_empty())
            .then(|| serde_json::to_string(&a.evidence).unwrap_or_default());
        let resp = a.response.clone();
        Self {
            id: a.alert_id,
            patient_id: a.patient_id,
            encounter_id: None,
            provider_id: a.provider_id,
            alert_datetime: created_at,
            alert_type: format!("{:?}", a.alert_type),
            alert_category: "clinical".to_string(),
            severity: format!("{:?}", a.severity).to_lowercase(),
            alert_title: a.title,
            alert_message: a.description,
            clinical_evidence,
            recommendation,
            source_system: None,
            rule_id: None,
            rule_version: None,
            trigger_data: Some(extras),
            related_order_id: None,
            related_medication_id: None,
            related_lab_id: None,
            status: format!("{:?}", a.status).to_lowercase(),
            acknowledged_by: resp.as_ref().map(|r| r.responded_by.clone()),
            acknowledged_datetime: resp.as_ref().map(|r| {
                DateTime::<Utc>::from_timestamp(r.responded_at, 0).unwrap_or_else(Utc::now)
            }),
            override_reason: resp.as_ref().and_then(|r| r.override_reason.clone()),
            override_justification: None,
            action_taken: resp.as_ref().map(|r| format!("{:?}", r.action_taken)),
            action_datetime: resp.as_ref().map(|r| {
                DateTime::<Utc>::from_timestamp(r.responded_at, 0).unwrap_or_else(Utc::now)
            }),
            auto_resolved: None,
            resolution_reason: None,
            was_helpful: None,
            feedback_notes: resp.as_ref().and_then(|r| r.notes.clone()),
            displayed_duration_seconds: resp.as_ref().map(|r| r.time_to_response_seconds as i32),
            created_at,
            updated_at: created_at,
        }
    }
}

// Appointment <-> AppointmentEntity conversions
// Legacy `Appointment` carries: provider_name, scheduled_date (string), start_time (string),
// scheduled_time (i64), is_telehealth, AppointmentLocation struct (5 fields),
// reminders_sent (Vec), instructions, booked_by. The entity flattens these to
// (scheduled_datetime, location: Option<String>, room: Option<String>), so we pack the
// extras into entity.data (a serde_json::Value). Note: entity.data is `#[sqlx(skip)]`,
// so on the postgres backend the extras don't survive a round-trip and the reverse
// conversion reconstructs sensible defaults from the persisted primary columns.

pub fn appt_pack_extras(a: &crate::clinical::Appointment) -> serde_json::Value {
    serde_json::json!({
        "provider_name": a.provider_name,
        "scheduled_date": a.scheduled_date,
        "start_time": a.start_time,
        "scheduled_time": a.scheduled_time,
        "is_telehealth": a.is_telehealth,
        "telehealth_session_id": a.telehealth_session_id,
        "location": a.location,
        "reminders_sent": a.reminders_sent,
        "instructions": a.instructions,
        "booked_by": a.booked_by,
        "visit_reason": a.visit_reason,
    })
}

pub fn appt_parse_type(s: &str) -> crate::clinical::AppointmentType {
    match s {
        "NewPatient" => crate::clinical::AppointmentType::NewPatient,
        "FollowUp" => crate::clinical::AppointmentType::FollowUp,
        "Urgent" => crate::clinical::AppointmentType::Urgent,
        "Telehealth" => crate::clinical::AppointmentType::Telehealth,
        "Procedure" => crate::clinical::AppointmentType::Procedure,
        "PreOp" => crate::clinical::AppointmentType::PreOp,
        "PostOp" => crate::clinical::AppointmentType::PostOp,
        "AnnualExam" => crate::clinical::AppointmentType::AnnualExam,
        "Consultation" => crate::clinical::AppointmentType::Consultation,
        "LabWork" => crate::clinical::AppointmentType::LabWork,
        "Imaging" => crate::clinical::AppointmentType::Imaging,
        _ => crate::clinical::AppointmentType::Other,
    }
}

pub fn appt_parse_status(s: &str) -> crate::clinical::AppointmentStatus {
    match s.to_lowercase().as_str() {
        "scheduled" => crate::clinical::AppointmentStatus::Scheduled,
        "declined" => crate::clinical::AppointmentStatus::Declined,
        "confirmed" => crate::clinical::AppointmentStatus::Confirmed,
        "checkedin" | "checked_in" => crate::clinical::AppointmentStatus::CheckedIn,
        "inprogress" | "in_progress" => crate::clinical::AppointmentStatus::InProgress,
        "completed" => crate::clinical::AppointmentStatus::Completed,
        "noshow" | "no_show" => crate::clinical::AppointmentStatus::NoShow,
        "cancelled" => crate::clinical::AppointmentStatus::Cancelled,
        "rescheduled" => crate::clinical::AppointmentStatus::Rescheduled,
        "waitlisted" => crate::clinical::AppointmentStatus::Waitlisted,
        _ => crate::clinical::AppointmentStatus::Scheduled,
    }
}

/// Parse a status from a *client*, refusing anything unrecognised.
///
/// [`appt_parse_status`] deliberately falls back to `Scheduled` because it
/// reads values already in the database, where a best effort beats failing a
/// read. That fallback is exactly wrong on an inbound request: it would let
/// `{"status":"complete"}` — a plausible typo for `completed` — silently
/// reset an appointment to scheduled. Request handlers use this instead and
/// return a 400.
pub fn appt_parse_status_strict(s: &str) -> Option<crate::clinical::AppointmentStatus> {
    use crate::clinical::AppointmentStatus as S;
    let key: String = s
        .chars()
        .filter(|c| !matches!(c, '-' | '_' | ' '))
        .flat_map(char::to_lowercase)
        .collect();
    Some(match key.as_str() {
        "scheduled" => S::Scheduled,
        "declined" => S::Declined,
        "confirmed" => S::Confirmed,
        "checkedin" => S::CheckedIn,
        "inprogress" => S::InProgress,
        "completed" => S::Completed,
        "noshow" => S::NoShow,
        "cancelled" | "canceled" => S::Cancelled,
        "rescheduled" => S::Rescheduled,
        "waitlisted" => S::Waitlisted,
        _ => return None,
    })
}

/// The stored spelling of an appointment status.
///
/// # Why this is not `format!("{:?}", status)`
///
/// It used to be. `Debug` produced `"Scheduled"` / `"CheckedIn"` / `"NoShow"`,
/// while the `appointments_status_check` constraint expects the snake_case
/// vocabulary (`'scheduled'`, `'checked_in'`, `'no_show'`), so every insert was
/// rejected — one of the two defects that meant no appointment had ever
/// persisted on PostgreSQL (`docs/WORKFLOW_AUDIT.md`, WF-030).
///
/// Beyond the immediate mismatch, `Debug` is the wrong tool for a persistence
/// format: it is explicitly not a stable contract, so renaming a variant would
/// silently change what lands in the database. This function is the contract,
/// and `appt_parse_status` is its inverse.
pub fn appt_status_storage_str(status: &crate::clinical::AppointmentStatus) -> &'static str {
    use crate::clinical::AppointmentStatus as S;
    match status {
        S::Scheduled => "scheduled",
        S::Declined => "declined",
        S::Confirmed => "confirmed",
        S::CheckedIn => "checked_in",
        S::InProgress => "in_progress",
        S::Completed => "completed",
        S::NoShow => "no_show",
        S::Cancelled => "cancelled",
        S::Rescheduled => "rescheduled",
        S::Waitlisted => "waitlisted",
    }
}

/// Parse "YYYY-MM-DD" + "HH:MM" into a UTC DateTime; falls back to `now` on error.
pub fn appt_to_datetime(date: &str, time: &str) -> DateTime<Utc> {
    let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .map(|d| {
            let t = chrono::NaiveTime::parse_from_str(time, "%H:%M")
                .ok()
                .or_else(|| chrono::NaiveTime::parse_from_str(time, "%H:%M:%S").ok())
                .unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap());
            // `scheduled_date` + `start_time` are **facility wall-clock**: what
            // the clinician or patient actually typed. Treating that naive value
            // as UTC (which `from_naive_utc_and_offset(.., Utc)` does) shifts
            // every appointment by the facility's offset — in SAST (UTC+2) a
            // 09:00 consultation became an 11:00 instant. That silently broke
            // the telehealth join window, which is enforced against the instant:
            // a patient at their real appointment time was told "this
            // consultation is not open to join yet" for two more hours.
            //
            // Displayed times were unaffected (the UI renders the `start_time`
            // string), which is exactly why this stayed hidden.
            let naive = d.and_time(t) - chrono::Duration::minutes(clinic_utc_offset_minutes());
            DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)
        });
    parsed.unwrap_or_else(Utc::now)
}

/// The facility's fixed offset from UTC, in minutes, from
/// `CLINIC_UTC_OFFSET_MINUTES` (e.g. `120` for SAST, `-300` for EST).
///
/// A fixed offset rather than an IANA zone because the deployment targets
/// (South Africa, Nigeria, Kenya, Ghana, Ethiopia) do not observe DST, and a
/// fixed offset needs no timezone database. Defaults to `0`, which preserves
/// the previous UTC-as-wall-clock behaviour; `startup` warns when it is unset so
/// a non-UTC deployment does not inherit the bug silently.
///
/// Values beyond ±14h are ignored as nonsense rather than applied.
pub fn clinic_utc_offset_minutes() -> i64 {
    const MAX_OFFSET_MINUTES: i64 = 14 * 60;
    std::env::var("CLINIC_UTC_OFFSET_MINUTES")
        .ok()
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|minutes| minutes.abs() <= MAX_OFFSET_MINUTES)
        .unwrap_or(0)
}

impl From<crate::clinical::Appointment> for crate::repositories::traits::AppointmentEntity {
    fn from(a: crate::clinical::Appointment) -> Self {
        let scheduled_datetime = a
            .scheduled_time
            .and_then(|ts| DateTime::<Utc>::from_timestamp(ts, 0))
            .unwrap_or_else(|| appt_to_datetime(&a.scheduled_date, &a.start_time));
        let created_at = DateTime::<Utc>::from_timestamp(a.created_at, 0).unwrap_or_else(Utc::now);
        let updated_at = DateTime::<Utc>::from_timestamp(a.updated_at, 0).unwrap_or_else(Utc::now);
        let check_in_time = a
            .check_in_time
            .and_then(|ts| DateTime::<Utc>::from_timestamp(ts, 0));
        let location_str = Some(format!(
            "{} / {}",
            a.location.facility_name, a.location.department
        ));
        let room = a.location.room.clone();
        // Both spellings are in the `appointments_visit_type_check` vocabulary.
        // Writing "in_person" rather than NULL makes the distinction explicit:
        // NULL previously meant "not telehealth" and "never recorded" alike.
        let visit_type = Some(if a.is_telehealth {
            "telehealth".to_string()
        } else {
            "in_person".to_string()
        });
        let extras = appt_pack_extras(&a);
        Self {
            id: a.appointment_id,
            patient_id: a.patient_id,
            provider_id: a.provider_id,
            appointment_type: format!("{:?}", a.appointment_type),
            scheduled_datetime,
            duration_minutes: a.duration_minutes as i32,
            status: appt_status_storage_str(&a.status).to_string(),
            location: location_str,
            room,
            reason_for_visit: Some(a.visit_reason),
            visit_type,
            priority: None,
            recurring: false,
            recurrence_pattern: None,
            parent_appointment_id: None,
            insurance_verified: a.insurance_verified,
            copay_amount: None,
            copay_collected: false,
            reminder_sent: !a.reminders_sent.is_empty(),
            reminder_sent_at: a
                .reminders_sent
                .last()
                .and_then(|r| DateTime::<Utc>::from_timestamp(r.sent_at, 0)),
            check_in_time,
            check_out_time: None,
            cancelled_at: None,
            cancellation_reason: None,
            cancelled_by: None,
            notes: a.notes,
            created_by: a.created_by,
            created_at,
            updated_at,
            data: extras,
        }
    }
}

impl From<crate::repositories::traits::AppointmentEntity> for crate::clinical::Appointment {
    fn from(e: crate::repositories::traits::AppointmentEntity) -> Self {
        // Extras packed into `data`; fall back to reconstruction when missing (postgres path).
        let extras = if e.data.is_object() {
            e.data.clone()
        } else {
            serde_json::json!({})
        };
        let scheduled_date = extras
            .get("scheduled_date")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| e.scheduled_datetime.format("%Y-%m-%d").to_string());
        let start_time = extras
            .get("start_time")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| e.scheduled_datetime.format("%H:%M").to_string());
        let scheduled_time = extras
            .get("scheduled_time")
            .and_then(|v| v.as_i64())
            .or(Some(e.scheduled_datetime.timestamp()));
        let provider_name = extras
            .get("provider_name")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| "Dr. Provider".to_string());
        let is_telehealth = extras
            .get("is_telehealth")
            .and_then(|v| v.as_bool())
            .unwrap_or(e.visit_type.as_deref() == Some("telehealth"));
        let location: crate::clinical::AppointmentLocation = extras
            .get("location")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_else(|| crate::clinical::AppointmentLocation {
                facility_name: e.location.clone().unwrap_or_default(),
                department: String::new(),
                room: e.room.clone(),
                address: None,
                telehealth_link: None,
            });
        let reminders_sent: Vec<crate::clinical::AppointmentReminder> = extras
            .get("reminders_sent")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let instructions = extras
            .get("instructions")
            .and_then(|v| v.as_str())
            .map(String::from);
        let telehealth_session_id = extras
            .get("telehealth_session_id")
            .and_then(|v| v.as_str())
            .map(String::from);
        let booked_by = extras
            .get("booked_by")
            .and_then(|v| v.as_str())
            .map(String::from);
        let visit_reason = extras
            .get("visit_reason")
            .and_then(|v| v.as_str())
            .map(String::from)
            .or(e.reason_for_visit.clone())
            .unwrap_or_default();
        Self {
            appointment_id: e.id,
            patient_id: e.patient_id,
            provider_id: e.provider_id,
            provider_name,
            appointment_type: appt_parse_type(&e.appointment_type),
            visit_reason,
            scheduled_date,
            start_time,
            scheduled_time,
            duration_minutes: e.duration_minutes as u16,
            location,
            status: appt_parse_status(&e.status),
            created_at: e.created_at.timestamp(),
            updated_at: e.updated_at.timestamp(),
            created_by: e.created_by,
            booked_by,
            check_in_time: e.check_in_time.map(|d| d.timestamp()),
            is_telehealth,
            telehealth_session_id,
            reminders_sent,
            instructions,
            insurance_verified: e.insurance_verified,
            notes: e.notes,
        }
    }
}

// ---- MedicationReminder <-> MedicationReminderEntity conversion ----
// Legacy `MedicationReminder` carries `reminder_times: Vec<String>` (multiple HH:MM
// strings per day), `frequency` enum, `created_by`, and `notification_prefs`. The
// entity has only a single `scheduled_time: NaiveTime`, so we pack the extras into
// `entity.data` (a `#[sqlx(skip)]` JSON bucket). Memory backend round-trips fully;
// Postgres backend loses extras and the background due-time matcher will only fire
// on the single `scheduled_time` after a postgres round-trip.

pub fn med_rem_pack_extras(r: &crate::clinical::MedicationReminder) -> serde_json::Value {
    serde_json::json!({
        "reminder_times": r.reminder_times,
        "frequency": format!("{:?}", r.frequency),
        "created_by": r.created_by,
        "notification_prefs": r.notification_prefs,
    })
}

pub fn med_rem_parse_frequency(s: &str) -> crate::clinical::ReminderFrequency {
    match s {
        "Once" => crate::clinical::ReminderFrequency::Once,
        "Daily" => crate::clinical::ReminderFrequency::Daily,
        "TwiceDaily" => crate::clinical::ReminderFrequency::TwiceDaily,
        "ThreeTimesDaily" => crate::clinical::ReminderFrequency::ThreeTimesDaily,
        "FourTimesDaily" => crate::clinical::ReminderFrequency::FourTimesDaily,
        "EveryOtherDay" => crate::clinical::ReminderFrequency::EveryOtherDay,
        "Weekly" => crate::clinical::ReminderFrequency::Weekly,
        "Biweekly" => crate::clinical::ReminderFrequency::Biweekly,
        "Monthly" => crate::clinical::ReminderFrequency::Monthly,
        "AsNeeded" => crate::clinical::ReminderFrequency::AsNeeded,
        "Custom" => crate::clinical::ReminderFrequency::Custom,
        _ => crate::clinical::ReminderFrequency::Daily,
    }
}

impl From<crate::clinical::MedicationReminder>
    for crate::repositories::traits::MedicationReminderEntity
{
    fn from(r: crate::clinical::MedicationReminder) -> Self {
        let scheduled_time = r
            .reminder_times
            .first()
            .and_then(|t| {
                chrono::NaiveTime::parse_from_str(t, "%H:%M")
                    .or_else(|_| chrono::NaiveTime::parse_from_str(t, "%H:%M:%S"))
                    .ok()
            })
            .unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap());
        let start_date = chrono::NaiveDate::parse_from_str(&r.start_date, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Utc::now().date_naive());
        let end_date = r
            .end_date
            .as_deref()
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
        let created_at = DateTime::<Utc>::from_timestamp(r.created_at, 0).unwrap_or_else(Utc::now);
        let extras = med_rem_pack_extras(&r);
        Self {
            id: r.reminder_id,
            patient_id: r.patient_id,
            prescription_id: None,
            medication_name: r.medication_name,
            dosage: Some(r.dosage),
            scheduled_time,
            days_of_week: serde_json::json!([]),
            reminder_type: format!("{:?}", r.frequency),
            is_active: r.active,
            snooze_minutes: None,
            max_snoozes: None,
            escalation_contact: None,
            start_date,
            end_date,
            notes: r.instructions,
            created_at,
            updated_at: created_at,
            data: extras,
        }
    }
}

impl From<crate::repositories::traits::MedicationReminderEntity>
    for crate::clinical::MedicationReminder
{
    fn from(e: crate::repositories::traits::MedicationReminderEntity) -> Self {
        let extras = if e.data.is_object() {
            e.data.clone()
        } else {
            serde_json::json!({})
        };
        let reminder_times: Vec<String> = extras
            .get("reminder_times")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_else(|| vec![e.scheduled_time.format("%H:%M").to_string()]);
        let frequency = extras
            .get("frequency")
            .and_then(|v| v.as_str())
            .map(med_rem_parse_frequency)
            .unwrap_or_else(|| med_rem_parse_frequency(&e.reminder_type));
        let created_by = extras
            .get("created_by")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_default();
        let notification_prefs: crate::clinical::NotificationPreferences = extras
            .get("notification_prefs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or(crate::clinical::NotificationPreferences {
                push_notification: true,
                sms: false,
                email: false,
                in_app: true,
                reminder_before_minutes: 15,
            });
        Self {
            reminder_id: e.id,
            patient_id: e.patient_id,
            medication_name: e.medication_name,
            dosage: e.dosage.unwrap_or_default(),
            frequency,
            reminder_times,
            start_date: e.start_date.format("%Y-%m-%d").to_string(),
            end_date: e.end_date.map(|d| d.format("%Y-%m-%d").to_string()),
            instructions: e.notes,
            active: e.is_active,
            created_by,
            created_at: e.created_at.timestamp(),
            notification_prefs,
        }
    }
}

// ---- ImmunizationRecord <-> ImmunizationRecordEntity conversion ----
// Most fields map directly. `expiration_date` and `registry_reported` have no
// columns in the entity, so they are packed into `entity.data` alongside a
// snapshot of the full record (used as a fast restore path on memory backend
// where `entity.data` round-trips). Postgres backend persists primary columns
// only; the reverse conversion reconstructs sensible defaults from those.

pub fn imm_pack_extras(r: &crate::clinical::ImmunizationRecord) -> serde_json::Value {
    serde_json::json!({
        "expiration_date": r.expiration_date,
        "registry_reported": r.registry_reported,
        "funding_source": r.funding_source,
        "route": r.route,
    })
}

pub fn imm_parse_route(s: &str) -> crate::clinical::ImmunizationRoute {
    match s {
        "Intramuscular" => crate::clinical::ImmunizationRoute::Intramuscular,
        "Subcutaneous" => crate::clinical::ImmunizationRoute::Subcutaneous,
        "Intradermal" => crate::clinical::ImmunizationRoute::Intradermal,
        "Oral" => crate::clinical::ImmunizationRoute::Oral,
        "Intranasal" => crate::clinical::ImmunizationRoute::Intranasal,
        _ => crate::clinical::ImmunizationRoute::Intramuscular,
    }
}

pub fn imm_parse_funding(s: &str) -> crate::clinical::FundingSource {
    match s {
        "Private" => crate::clinical::FundingSource::Private,
        "PublicVFC" => crate::clinical::FundingSource::PublicVFC,
        "PublicState" => crate::clinical::FundingSource::PublicState,
        "Military" => crate::clinical::FundingSource::Military,
        _ => crate::clinical::FundingSource::Other,
    }
}

impl From<crate::clinical::ImmunizationRecord>
    for crate::repositories::traits::ImmunizationRecordEntity
{
    fn from(r: crate::clinical::ImmunizationRecord) -> Self {
        let administration_date =
            chrono::NaiveDate::parse_from_str(&r.administration_date, "%Y-%m-%d")
                .unwrap_or_else(|_| chrono::Utc::now().date_naive());
        let vis_date = chrono::NaiveDate::parse_from_str(&r.vis_date, "%Y-%m-%d").ok();
        let now = chrono::Utc::now();
        let extras = imm_pack_extras(&r);
        Self {
            id: r.record_id,
            patient_id: r.patient_id,
            vaccine_type: String::new(),
            vaccine_name: r.vaccine_name,
            manufacturer: Some(r.manufacturer),
            lot_number: Some(r.lot_number),
            ndc_code: None,
            cvx_code: Some(r.cvx_code),
            mvx_code: None,
            administration_date,
            administration_time: None,
            administered_by: Some(r.administered_by),
            administered_by_name: None,
            administration_site: Some(r.site),
            route: Some(format!("{:?}", r.route)),
            dose_amount: None,
            dose_unit: None,
            dose_number: Some(r.dose_number as i32),
            series_complete: None,
            facility_id: None,
            facility_name: None,
            facility_address: None,
            vfc_eligibility: None,
            funding_source: Some(format!("{:?}", r.funding_source)),
            information_source: None,
            documentation_type: None,
            reaction_observed: Some(r.adverse_reaction.is_some()),
            reaction_details: r.adverse_reaction,
            contraindications_reviewed: None,
            patient_consent: None,
            vis_given: Some(!r.vis_date.is_empty()),
            vis_date,
            notes: r.notes,
            created_at: Some(now),
            updated_at: Some(now),
            data: extras,
        }
    }
}

impl From<crate::repositories::traits::ImmunizationRecordEntity>
    for crate::clinical::ImmunizationRecord
{
    fn from(e: crate::repositories::traits::ImmunizationRecordEntity) -> Self {
        let extras = if e.data.is_object() {
            e.data.clone()
        } else {
            serde_json::json!({})
        };
        let expiration_date = extras
            .get("expiration_date")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_default();
        let registry_reported = extras
            .get("registry_reported")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let funding_source = extras
            .get("funding_source")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_else(|| {
                e.funding_source
                    .as_deref()
                    .map(imm_parse_funding)
                    .unwrap_or(crate::clinical::FundingSource::Other)
            });
        let route = extras
            .get("route")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_else(|| {
                e.route
                    .as_deref()
                    .map(imm_parse_route)
                    .unwrap_or(crate::clinical::ImmunizationRoute::Intramuscular)
            });
        Self {
            record_id: e.id,
            patient_id: e.patient_id,
            vaccine_name: e.vaccine_name,
            cvx_code: e.cvx_code.unwrap_or_default(),
            manufacturer: e.manufacturer.unwrap_or_default(),
            lot_number: e.lot_number.unwrap_or_default(),
            expiration_date,
            administration_date: e.administration_date.format("%Y-%m-%d").to_string(),
            dose_number: e.dose_number.unwrap_or(1) as u8,
            route,
            site: e.administration_site.unwrap_or_default(),
            administered_by: e.administered_by.unwrap_or_default(),
            vis_date: e
                .vis_date
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_default(),
            funding_source,
            registry_reported,
            adverse_reaction: e.reaction_details,
            notes: e.notes,
        }
    }
}

impl From<crate::repositories::traits::CdsAlertEntity> for crate::clinical::CDSAlert {
    fn from(e: crate::repositories::traits::CdsAlertEntity) -> Self {
        let extras = e.trigger_data.unwrap_or_else(|| serde_json::json!({}));
        let triggering_data = extras
            .get("triggering_data")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let clinical_context = extras
            .get("clinical_context")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let expires_at = extras.get("expires_at").and_then(|v| v.as_i64());
        let guideline_reference = extras
            .get("guideline_reference")
            .and_then(|v| v.as_str())
            .map(String::from);
        let recommended_actions = e
            .recommendation
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        let evidence = e
            .clinical_evidence
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        let response = e
            .action_taken
            .as_deref()
            .map(|action| crate::clinical::CDSResponse {
                responded_at: e.action_datetime.unwrap_or(e.created_at).timestamp(),
                responded_by: e.acknowledged_by.clone().unwrap_or_default(),
                action_taken: cds_parse_action_taken(action),
                override_reason: e.override_reason.clone(),
                notes: e.feedback_notes.clone(),
                time_to_response_seconds: e.displayed_duration_seconds.unwrap_or(0) as u32,
            });
        Self {
            alert_id: e.id,
            patient_id: e.patient_id,
            provider_id: e.provider_id,
            alert_type: cds_parse_alert_type(&e.alert_type),
            severity: cds_parse_severity(&e.severity),
            title: e.alert_title,
            description: e.alert_message,
            clinical_context,
            triggering_data,
            recommended_actions,
            evidence,
            guideline_reference,
            created_at: e.created_at.timestamp(),
            expires_at,
            status: cds_parse_status(&e.status),
            response,
        }
    }
}

// =============================================================================
// Peri-operative documentation (migration 20260810000001)
//
// These conversions have one rule that is not negotiable: `record_json` (the
// entity's `data` field) is the source of truth on the way back out. The typed
// columns are a *projection* for querying and reporting.
//
// The reason is that `PreOperativeAssessment` carries fields the table never
// modelled — including `site_verified` and `site_marked`, the WHO Surgical
// Safety Checklist items that exist to prevent wrong-site surgery. Rebuilding
// the API object from the typed columns would drop them while looking like it
// worked. So writes project what they can and store everything; reads
// deserialize what was stored.
//
// Where no faithful mapping exists, the projection is left empty rather than
// guessed. `cleared_for_surgery` in particular defaults to false: an unknown
// surgical clearance must fail closed.
// =============================================================================

fn asa_class_column(class: &crate::clinical::ASAClassification) -> Option<String> {
    use crate::clinical::ASAClassification as A;
    match class {
        A::ASA1 => Some("I".to_string()),
        A::ASA2 => Some("II".to_string()),
        A::ASA3 => Some("III".to_string()),
        A::ASA4 => Some("IV".to_string()),
        A::ASA5 => Some("V".to_string()),
        A::ASA6 => Some("VI".to_string()),
        // A modifier, not a class of its own. The column's CHECK constraint has
        // no value for it; the truth stays in record_json.
        A::Emergency => None,
    }
}

fn mallampati_column(score: &crate::clinical::MallampatiScore) -> i32 {
    use crate::clinical::MallampatiScore as M;
    match score {
        M::Class1 => 1,
        M::Class2 => 2,
        M::Class3 => 3,
        M::Class4 => 4,
    }
}

impl From<crate::clinical::PreOperativeAssessment>
    for crate::repositories::traits::PreOpAssessmentEntity
{
    fn from(a: crate::clinical::PreOperativeAssessment) -> Self {
        // Stored before the typed projection borrows from `a`, so a
        // serialization failure cannot produce a row with an empty payload.
        let data = serde_json::to_value(&a).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();

        Self {
            id: a.assessment_id,
            patient_id: a.patient_id,
            procedure_name: a.scheduled_procedure,
            scheduled_date: chrono::DateTime::parse_from_rfc3339(&a.procedure_datetime)
                .ok()
                .map(|d| d.with_timezone(&chrono::Utc)),
            surgeon_id: a.surgeon,
            anesthesiologist_id: a.anesthesiologist,
            asa_classification: asa_class_column(&a.asa_class),
            mallampati_score: Some(mallampati_column(&a.airway_assessment)),
            airway_assessment: serde_json::to_value(&a.airway_assessment).ok(),
            medications_reviewed: Some(serde_json::json!(a.medications_reviewed)),
            allergies_confirmed: a.allergies_reviewed,
            npo_status: Some(
                if a.npo_status.compliant {
                    "compliant"
                } else {
                    "non_compliant"
                }
                .to_string(),
            ),
            labs_reviewed: Some(serde_json::json!(a.labs_reviewed)),
            consent_signed: a.consent_signed,
            blood_type_confirmed: Some(a.blood_type_confirmed),
            assessment_notes: a.notes,
            assessed_by: a.assessed_by,
            assessed_at: chrono::DateTime::from_timestamp(a.assessed_at, 0).unwrap_or(now),
            // No faithful source in the API type. `imaging_reviewed` is not the
            // same statement as "the chest x-ray was reviewed", so it is not
            // borrowed for these columns.
            cleared_for_surgery: false,
            created_at: now,
            updated_at: now,
            data,
            ..Default::default()
        }
    }
}

impl TryFrom<crate::repositories::traits::PreOpAssessmentEntity>
    for crate::clinical::PreOperativeAssessment
{
    type Error = serde_json::Error;

    /// Rebuilds the assessment from the stored payload, never from the typed
    /// projection. A row whose `record_json` is missing or malformed is an
    /// error, not a partially populated assessment — returning half a surgical
    /// safety checklist would be worse than returning none.
    fn try_from(
        entity: crate::repositories::traits::PreOpAssessmentEntity,
    ) -> Result<Self, Self::Error> {
        serde_json::from_value(entity.data)
    }
}

/// The team member filling `role`, by name. The columns hold one identifier
/// each; the full team stays in `record_json`.
fn team_member_named(
    team: &[crate::clinical::SurgicalTeamMember],
    role: crate::clinical::SurgicalRole,
) -> Option<String> {
    team.iter().find(|m| m.role == role).map(|m| m.name.clone())
}

fn anesthesia_type_column(kind: &crate::clinical::AnesthesiaType) -> String {
    use crate::clinical::AnesthesiaType as T;
    // The column's CHECK constraint predates the API enum and has no value for
    // Spinal or Epidural. Both are neuraxial regional techniques, so they
    // project to 'regional'; the exact technique stays in record_json.
    match kind {
        T::General => "general",
        T::Spinal | T::Epidural | T::Regional => "regional",
        T::LocalWithSedation => "sedation",
        T::LocalOnly => "local",
        T::MAC => "mac",
    }
    .to_string()
}

fn utc_from_unix(seconds: i64) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::from_timestamp(seconds, 0).unwrap_or_else(chrono::Utc::now)
}

impl From<crate::clinical::OperativeNote> for crate::repositories::traits::OperativeNoteEntity {
    fn from(n: crate::clinical::OperativeNote) -> Self {
        use crate::clinical::SurgicalRole as R;
        let data = serde_json::to_value(&n).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();

        Self {
            id: n.note_id,
            patient_id: n.patient_id,
            procedure_name: n.procedure_performed,
            procedure_codes: serde_json::to_value(&n.cpt_codes).ok(),
            // The API models diagnoses as lists; the columns are single text
            // fields. Joined for the projection, preserved in record_json.
            preoperative_diagnosis: n.pre_op_diagnosis.join("; "),
            postoperative_diagnosis: n.post_op_diagnosis.join("; "),
            surgeon_id: team_member_named(&n.surgeons, R::PrimarySurgeon)
                .or_else(|| n.surgeons.first().map(|m| m.name.clone()))
                .unwrap_or_default(),
            assistant_surgeons: serde_json::to_value(
                n.surgeons
                    .iter()
                    .filter(|m| matches!(m.role, R::Assistant | R::Resident))
                    .collect::<Vec<_>>(),
            )
            .ok(),
            anesthesiologist_id: n.anesthesia_team.first().cloned(),
            anesthesia_type: anesthesia_type_column(&n.anesthesia_type),
            scrub_nurse_id: team_member_named(&n.surgeons, R::ScrubNurse),
            circulating_nurse_id: team_member_named(&n.surgeons, R::CirculatingNurse),
            start_time: utc_from_unix(n.time_in_or),
            end_time: utc_from_unix(n.time_out_or),
            estimated_blood_loss_ml: i32::try_from(n.estimated_blood_loss).ok(),
            // `fluids_given` is free text ("2L crystalloid"), not a millilitre
            // count. Parsing it into a number would be an invention.
            blood_products_given: serde_json::to_value(&n.blood_products).ok(),
            specimens_collected: serde_json::to_value(&n.specimens).ok(),
            implants_used: serde_json::to_value(&n.implants).ok(),
            drains_placed: serde_json::to_value(&n.drains).ok(),
            operative_findings: Some(n.findings),
            procedure_description: n.procedure_details,
            complications: n.complications,
            disposition: Some(n.disposition),
            created_at: now,
            updated_at: now,
            data,
            ..Default::default()
        }
    }
}

impl TryFrom<crate::repositories::traits::OperativeNoteEntity> for crate::clinical::OperativeNote {
    type Error = serde_json::Error;

    fn try_from(
        entity: crate::repositories::traits::OperativeNoteEntity,
    ) -> Result<Self, Self::Error> {
        serde_json::from_value(entity.data)
    }
}

impl From<crate::clinical::PostOperativeNote> for crate::repositories::traits::PostOpNoteEntity {
    fn from(n: crate::clinical::PostOperativeNote) -> Self {
        let data = serde_json::to_value(&n).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();

        Self {
            id: n.note_id,
            patient_id: n.patient_id,
            // The API type carries no operative-note link; nullable since
            // migration 20260810000001.
            operative_note_id: None,
            post_op_day: i32::from(n.post_op_day),
            note_date: utc_from_unix(n.note_time),
            provider_id: n.written_by,
            pain_level: Some(i32::from(n.pain_score)),
            pain_management: Some(n.pain_management),
            wound_assessment: serde_json::to_value(&n.wound).ok(),
            drain_output: n
                .drain_output
                .as_ref()
                .and_then(|d| serde_json::to_value(d).ok()),
            diet_status: Some(n.diet),
            ambulation_status: Some(n.activity),
            voiding_status: n.foley.clone(),
            lab_results_reviewed: n.labs.as_ref().and_then(|l| serde_json::to_value(l).ok()),
            complications: n.complications.clone(),
            plan: Some(n.plan.join("; ")),
            // No discharge-criteria field in the API type. False is the safe
            // default: an unknown readiness must not read as "ready".
            discharge_criteria_met: false,
            estimated_discharge_date: n
                .estimated_discharge
                .as_deref()
                .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()),
            created_at: now,
            updated_at: now,
            data,
            ..Default::default()
        }
    }
}

impl TryFrom<crate::repositories::traits::PostOpNoteEntity> for crate::clinical::PostOperativeNote {
    type Error = serde_json::Error;

    fn try_from(
        entity: crate::repositories::traits::PostOpNoteEntity,
    ) -> Result<Self, Self::Error> {
        serde_json::from_value(entity.data)
    }
}

impl From<crate::clinical::AnesthesiaRecord>
    for crate::repositories::traits::AnesthesiaRecordEntity
{
    fn from(r: crate::clinical::AnesthesiaRecord) -> Self {
        let data = serde_json::to_value(&r).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();

        Self {
            id: r.record_id,
            patient_id: r.patient_id,
            operative_note_id: None,
            anesthesiologist_id: r.anesthesiologist,
            crna_id: r.crna,
            anesthesia_type: anesthesia_type_column(&r.anesthesia_type),
            asa_classification: asa_class_column(&r.asa_class),
            airway_management: serde_json::to_value(&r.airway).ok(),
            induction_agents: serde_json::to_value(&r.induction).ok(),
            maintenance_agents: serde_json::to_value(&r.maintenance).ok(),
            intraop_fluids: serde_json::to_value(&r.fluids).ok(),
            blood_products: serde_json::to_value(&r.blood_products).ok(),
            vital_signs_timeline: serde_json::to_value(&r.vital_signs).ok(),
            events: serde_json::to_value(&r.intraop_events).ok(),
            complications: if r.complications.is_empty() {
                None
            } else {
                Some(r.complications.join("; "))
            },
            created_at: now,
            updated_at: now,
            data,
            ..Default::default()
        }
    }
}

impl TryFrom<crate::repositories::traits::AnesthesiaRecordEntity>
    for crate::clinical::AnesthesiaRecord
{
    type Error = serde_json::Error;

    fn try_from(
        entity: crate::repositories::traits::AnesthesiaRecordEntity,
    ) -> Result<Self, Self::Error> {
        serde_json::from_value(entity.data)
    }
}

// ---------------------------------------------------------------------------
// Radiology and pathology (migration 20260811000001)
//
// Same shape as the peri-operative conversions above: the typed columns are a
// queryable projection and `record_json` carries the whole API object, so the
// round trip cannot silently drop structure the columns do not model.
// ---------------------------------------------------------------------------

/// Base imaging modality for the `modality` column, whose CHECK constraint
/// accepts only these values. Contrast is carried separately in
/// `contrast_required`, so `CTWithContrast` and `CT` share a modality rather
/// than inventing a value the column would reject.
fn radiology_modality_column(kind: &crate::clinical::RadiologyStudyType) -> String {
    use crate::clinical::RadiologyStudyType as T;
    match kind {
        T::XRay => "xray",
        T::CT | T::CTWithContrast => "ct",
        T::MRI | T::MRIWithContrast => "mri",
        T::Ultrasound => "ultrasound",
        T::Nuclear => "nuclear",
        T::PET => "pet",
        T::Fluoroscopy => "fluoroscopy",
        T::Mammography => "mammography",
        T::Angiography => "angiography",
    }
    .to_string()
}

fn radiology_uses_contrast(kind: &crate::clinical::RadiologyStudyType) -> bool {
    use crate::clinical::RadiologyStudyType as T;
    matches!(kind, T::CTWithContrast | T::MRIWithContrast)
}

fn order_priority_column(priority: &crate::clinical::OrderPriority) -> String {
    use crate::clinical::OrderPriority as P;
    match priority {
        P::Stat => "stat",
        P::Urgent => "urgent",
        P::Routine => "routine",
        P::Scheduled => "scheduled",
        P::PRN => "prn",
    }
    .to_string()
}

fn radiology_order_status_column(status: &crate::clinical::RadiologyOrderStatus) -> String {
    use crate::clinical::RadiologyOrderStatus as S;
    match status {
        S::Ordered => "ordered",
        S::Scheduled => "scheduled",
        S::InProgress => "in_progress",
        S::Completed => "completed",
        S::Preliminary => "preliminary",
        S::Final => "final",
        S::Cancelled => "cancelled",
    }
    .to_string()
}

fn laterality_column(laterality: &crate::clinical::Laterality) -> String {
    use crate::clinical::Laterality as L;
    match laterality {
        L::Left => "left",
        L::Right => "right",
        L::Bilateral => "bilateral",
        L::NA => "na",
    }
    .to_string()
}

impl From<crate::clinical::RadiologyOrder> for crate::repositories::traits::RadiologyOrderEntity {
    fn from(o: crate::clinical::RadiologyOrder) -> Self {
        let data = serde_json::to_value(&o).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();

        Self {
            id: o.order_id,
            patient_id: o.patient_id,
            ordering_provider_id: o.ordering_provider,
            modality: radiology_modality_column(&o.study_type),
            // The precise variant (including the contrast distinction the
            // modality column cannot express) is preserved here and in the
            // payload.
            study_type: format!("{:?}", o.study_type),
            body_part: o.body_part,
            laterality: o.laterality.as_ref().map(laterality_column),
            priority: order_priority_column(&o.priority),
            status: radiology_order_status_column(&o.status),
            clinical_indication: o.indication,
            contrast_required: Some(o.contrast || radiology_uses_contrast(&o.study_type)),
            special_instructions: o.special_instructions,
            created_at: now,
            updated_at: now,
            data,
            ..Default::default()
        }
    }
}

impl TryFrom<crate::repositories::traits::RadiologyOrderEntity>
    for crate::clinical::RadiologyOrder
{
    type Error = serde_json::Error;

    fn try_from(
        entity: crate::repositories::traits::RadiologyOrderEntity,
    ) -> Result<Self, Self::Error> {
        serde_json::from_value(entity.data)
    }
}

fn radiology_report_status_column(status: &crate::clinical::RadiologyReportStatus) -> String {
    use crate::clinical::RadiologyReportStatus as S;
    match status {
        S::Preliminary => "preliminary",
        S::Final => "final",
        S::Addendum => "addendum",
        S::Corrected => "corrected",
    }
    .to_string()
}

impl From<crate::clinical::RadiologyReport> for crate::repositories::traits::RadiologyReportEntity {
    fn from(r: crate::clinical::RadiologyReport) -> Self {
        let data = serde_json::to_value(&r).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();

        Self {
            id: r.report_id,
            order_id: r.order_id,
            patient_id: r.patient_id,
            radiologist_id: r.radiologist,
            study_datetime: utc_from_unix(r.study_datetime),
            report_datetime: now,
            comparison_studies: r.comparison,
            technique: Some(r.technique),
            findings: r.findings,
            // The API models the impression as a list of statements; the
            // column is a single text field. Joined for the projection,
            // preserved verbatim in record_json.
            impression: r.impression.join("; "),
            recommendations: r.recommendations,
            critical_finding: r.critical_finding,
            critical_finding_communicated: Some(r.critical_communicated.is_some()),
            communicated_to: r
                .critical_communicated
                .as_ref()
                .map(|c| c.communicated_to.clone()),
            communicated_at: r
                .critical_communicated
                .as_ref()
                .map(|c| utc_from_unix(c.communication_time)),
            communication_method: r.critical_communicated.as_ref().map(|c| c.method.clone()),
            status: radiology_report_status_column(&r.status),
            pacs_study_uid: r.dicom_study_uid,
            created_at: now,
            updated_at: now,
            data,
            ..Default::default()
        }
    }
}

impl TryFrom<crate::repositories::traits::RadiologyReportEntity>
    for crate::clinical::RadiologyReport
{
    type Error = serde_json::Error;

    fn try_from(
        entity: crate::repositories::traits::RadiologyReportEntity,
    ) -> Result<Self, Self::Error> {
        serde_json::from_value(entity.data)
    }
}

fn pathology_status_column(status: &crate::clinical::PathologyStatus) -> String {
    use crate::clinical::PathologyStatus as S;
    match status {
        S::Pending => "pending",
        S::Preliminary => "preliminary",
        S::Final => "final",
        S::Amended => "amended",
    }
    .to_string()
}

/// Parse the API's string dates into a timestamp column, falling back to the
/// epoch rather than "now" when the value is unparseable: a wrong collection
/// date that reads as today is more misleading than an obviously invalid one,
/// and the exact original string is retained in `record_json` either way.
fn pathology_date_column(value: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|d| d.with_timezone(&chrono::Utc))
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").map(|d| {
                chrono::DateTime::from_naive_utc_and_offset(
                    d.and_hms_opt(0, 0, 0).unwrap_or_default(),
                    chrono::Utc,
                )
            })
        })
        .unwrap_or_else(|_| chrono::DateTime::from_timestamp(0, 0).unwrap_or_default())
}

impl From<crate::clinical::PathologyReport> for crate::repositories::traits::PathologyReportEntity {
    fn from(r: crate::clinical::PathologyReport) -> Self {
        let data = serde_json::to_value(&r).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();

        Self {
            id: r.report_id,
            patient_id: r.patient_id,
            specimen_id: None,
            ordering_provider_id: r.pathologist.clone(),
            pathologist_id: r.pathologist,
            specimen_type: format!("{:?}", r.specimen_type),
            specimen_source: r.specimen_source,
            collection_date: pathology_date_column(&r.collection_date),
            received_date: pathology_date_column(&r.received_date),
            report_date: pathology_date_column(&r.report_date),
            clinical_history: Some(r.clinical_history),
            gross_description: r.gross_description,
            microscopic_description: r.microscopic_description,
            special_stains: serde_json::to_value(&r.special_stains).ok(),
            immunohistochemistry: serde_json::to_value(&r.ihc).ok(),
            molecular_studies: serde_json::to_value(&r.molecular).ok(),
            // The API models the diagnosis as a list; the column is one text
            // field. Joined for the projection, preserved in record_json.
            diagnosis: r.diagnosis.join("; "),
            staging: r.synoptic.as_ref().map(|s| s.histologic_grade.clone()),
            synoptic_report: r
                .synoptic
                .as_ref()
                .and_then(|s| serde_json::to_value(s).ok()),
            comments: r.comment,
            status: pathology_status_column(&r.status),
            created_at: now,
            updated_at: now,
            data,
            ..Default::default()
        }
    }
}

impl TryFrom<crate::repositories::traits::PathologyReportEntity>
    for crate::clinical::PathologyReport
{
    type Error = serde_json::Error;

    fn try_from(
        entity: crate::repositories::traits::PathologyReportEntity,
    ) -> Result<Self, Self::Error> {
        serde_json::from_value(entity.data)
    }
}
