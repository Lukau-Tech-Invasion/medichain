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

/// Parse "YYYY-MM-DD" + "HH:MM" into a UTC DateTime; falls back to `now` on error.
pub fn appt_to_datetime(date: &str, time: &str) -> DateTime<Utc> {
    let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .and_then(|d| {
            let t = chrono::NaiveTime::parse_from_str(time, "%H:%M")
                .ok()
                .or_else(|| chrono::NaiveTime::parse_from_str(time, "%H:%M:%S").ok())
                .unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap());
            Some(DateTime::<Utc>::from_naive_utc_and_offset(
                d.and_time(t),
                Utc,
            ))
        });
    parsed.unwrap_or_else(Utc::now)
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
        let visit_type = if a.is_telehealth {
            Some("telehealth".to_string())
        } else {
            None
        };
        let extras = appt_pack_extras(&a);
        Self {
            id: a.appointment_id,
            patient_id: a.patient_id,
            provider_id: a.provider_id,
            appointment_type: format!("{:?}", a.appointment_type),
            scheduled_datetime,
            duration_minutes: a.duration_minutes as i32,
            status: format!("{:?}", a.status),
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
