use super::*;

/// Dashboard counts and queues are clinical claims, not optional decoration.
macro_rules! required_dashboard_read {
    ($result:expr, $area:literal) => {
        match $result {
            Ok(value) => value,
            Err(error) => {
                log::error!("{} read failed: {error}", $area);
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    error: "Dashboard data is temporarily unavailable".to_string(),
                    code: "DASHBOARD_DATA_UNAVAILABLE".to_string(),
                });
            }
        }
    };
}

#[cfg(test)]
mod patient_dashboard_tests {
    use super::*;
    use actix_web::{test, App};

    fn patient(wallet: &str, patient_id: &str) -> crate::User {
        crate::User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Dashboard Patient".to_string(),
            role: crate::Role::Patient,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: Some(patient_id.to_string()),
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    fn profile(patient_id: &str) -> crate::PatientProfile {
        let now = chrono::Utc::now();
        crate::PatientProfile {
            patient_id: patient_id.to_string(),
            full_name: "Linked Dashboard Patient".to_string(),
            date_of_birth: "1990-01-01".to_string(),
            time_of_birth: None,
            national_id: "DASHBOARD-TEST-ID".to_string(),
            gender: None,
            phone: "+27000000400".to_string(),
            emergency_info: crate::EmergencyInfo {
                patient_id: patient_id.to_string(),
                blood_type: crate::BloodType::OPositive,
                allergies: Vec::new(),
                current_medications: Vec::new(),
                chronic_conditions: Vec::new(),
                emergency_contacts: Vec::new(),
                organ_donor: false,
                dnr_status: false,
                dnr_verified_by: None,
                dnr_verified_at: None,
                dnr_document_ref: None,
                languages: vec!["en".to_string()],
                last_updated: now,
            },
            address: None,
            insurance: None,
            primary_doctor: None,
            community_health_worker: None,
            preferences: crate::PatientPreferences::default(),
            advanced_directives: Vec::new(),
            family_notifications: None,
            created_at: now,
            last_updated: now,
        }
    }

    #[actix_web::test]
    async fn patient_dashboard_reads_the_linked_clinical_record_not_the_wallet() {
        let state = crate::AppState::new();
        let wallet = "patient-dashboard-wallet";
        let patient_id = "PAT-DASH-LINKED";
        state
            .users
            .write()
            .expect("user store lock")
            .insert(wallet.to_string(), patient(wallet, patient_id));
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &profile(patient_id),
                &state.encryption_keyring,
            ))
            .await
            .expect("seed linked patient");

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(patient_dashboard),
        )
        .await;
        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/dashboard/patient")
                .insert_header(("x-user-id", wallet))
                .to_request(),
        )
        .await;

        assert_eq!(response.status(), 200);
        let body: serde_json::Value = test::read_body_json(response).await;
        assert_eq!(body["user_id"], wallet);
        assert_eq!(body["patient_id"], patient_id);
        assert_eq!(body["profile"]["patient_id"], patient_id);
    }

    #[actix_web::test]
    async fn patient_dashboard_rejects_non_patient_accounts() {
        let state = crate::AppState::new();
        let mut clinician = patient("clinician-dashboard-wallet", "PAT-NOT-USED");
        clinician.role = crate::Role::Doctor;
        state
            .users
            .write()
            .expect("user store lock")
            .insert(clinician.wallet_address.clone(), clinician);
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(patient_dashboard),
        )
        .await;
        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/dashboard/patient")
                .insert_header(("x-user-id", "clinician-dashboard-wallet"))
                .to_request(),
        )
        .await;

        assert_eq!(response.status(), 403);
    }
}

// ============================================================================
// DASHBOARD ENDPOINTS
// ============================================================================

/// Patient Home Dashboard - timeline of visits, meds, test results
#[get("/api/dashboard/patient")]
pub async fn patient_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // This is the patient's own dashboard. A registered clinician must use
    // their role-specific dashboard rather than being able to ask this route
    // for a record keyed by their wallet address.
    if current_user.role != crate::Role::Patient {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Patient dashboard is restricted to patient accounts".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Authentication identities are wallet addresses; clinical repositories
    // are keyed by patient id. The link is deliberately explicit across the
    // rest of the application. Using `current_user_id` below made the route
    // permanently fail for every wallet-linked patient.
    let patient_id = current_user
        .linked_patient_id
        .clone()
        .unwrap_or_else(|| current_user.wallet_address.clone());

    // The repository entity is an encrypted storage shape, not the public
    // dashboard contract. Returning it under `profile` gave clients a value
    // with `id` instead of `patient_id` and omitted the actual readable
    // clinical profile they were typed to consume.
    let patient_entity = required_dashboard_read!(
        data.repositories.patients.get_by_id(&patient_id).await,
        "patient dashboard profile"
    );
    let patient_profile =
        match crate::types::patient_entity_to_profile(&patient_entity, &data.encryption_keyring) {
            Some(profile) => profile,
            None => {
                log::error!("patient dashboard profile is unreadable for {patient_id}");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    error: "Dashboard data is temporarily unavailable".to_string(),
                    code: "DASHBOARD_DATA_UNAVAILABLE".to_string(),
                });
            }
        };

    // Get recent lab results (approved only for patients) from repository
    let pagination = Pagination::new(0, 10);
    let lab_results: Vec<_> = required_dashboard_read!(
        data.repositories
            .lab_submissions
            .get_by_patient(&patient_id, pagination)
            .await,
        "patient dashboard lab results"
    )
    .items
    .into_iter()
    .filter(|s| current_user.role.can_view_medical_records() || s.status == "approved")
    .collect();

    // Get medical records from repository
    let pagination = Pagination::new(0, 50);
    let medical_records = required_dashboard_read!(
        data.repositories
            .medical_records
            .get_by_patient(&patient_id, pagination)
            .await,
        "patient dashboard medical records"
    )
    .items;

    // Get latest vital signs from repository
    let vital_signs = required_dashboard_read!(
        data.repositories
            .vital_signs
            .get_latest_by_patient(&patient_id)
            .await,
        "patient dashboard vital signs"
    );

    // Get SOAP notes (Progress notes) from repository
    let pagination = Pagination::new(0, 5);
    let soap_notes = required_dashboard_read!(
        data.repositories
            .progress_notes
            .get_by_patient(&patient_id, pagination)
            .await,
        "patient dashboard progress notes"
    )
    .items;

    // Get triage assessments from repository
    let pagination = Pagination::new(0, 5);
    let triage_history = required_dashboard_read!(
        data.repositories
            .triage_assessments
            .get_by_patient(&patient_id, pagination)
            .await,
        "patient dashboard triage history"
    )
    .items;

    HttpResponse::Ok().json(serde_json::json!({
        "user_id": current_user_id,
        "patient_id": patient_id,
        "role": current_user.role.to_string(),
        "profile": patient_profile,
        "recent_lab_results": lab_results,
        "medical_records": medical_records,
        "vital_signs": vital_signs,
        "soap_notes": soap_notes,
        "triage_history": triage_history
    }))
}

/// A patient as the provider dashboards need to show them.
///
/// Deliberately NOT the raw `PatientEntity`: that carries `national_id_hash`,
/// `key_version` and the encrypted column set, none of which a dashboard has any
/// use for, and it carries no readable name — which is why the dashboards
/// rendered an empty roster even with patients present.
#[derive(Debug, serde::Serialize)]
pub struct DashboardPatient {
    pub patient_id: String,
    pub health_id: String,
    pub full_name: String,
    pub date_of_birth: String,
    pub gender: String,
    pub blood_type: Option<String>,
    pub allergies: Vec<String>,
    pub current_medications: Vec<String>,
    pub medical_conditions: Vec<String>,
    pub emergency_contact: Option<serde_json::Value>,
    /// False when the row exists but its PHI could not be decrypted. Such a
    /// patient is still listed — silently dropping it would make a record that
    /// exists indistinguishable from one that was never created.
    pub content_available: bool,
}

/// Project a stored patient row into the dashboard view, decrypting where possible.
fn dashboard_patient(
    entity: &crate::repositories::traits::PatientEntity,
    keyring: &crate::encryption_keyring::EncryptionKeyring,
) -> DashboardPatient {
    let Some(p) = patient_entity_to_profile(entity, keyring) else {
        return DashboardPatient {
            patient_id: entity.id.clone(),
            health_id: entity.health_id.clone(),
            full_name: format!("[unreadable record {}]", entity.id),
            date_of_birth: String::new(),
            gender: entity.gender.clone().unwrap_or_default(),
            blood_type: entity.blood_type.clone(),
            allergies: Vec::new(),
            current_medications: Vec::new(),
            medical_conditions: Vec::new(),
            emergency_contact: None,
            content_available: false,
        };
    };
    let contact = p.emergency_info.emergency_contacts.first().map(
        |c| serde_json::json!({ "name": c.name, "phone": c.phone, "relationship": c.relationship }),
    );
    DashboardPatient {
        patient_id: p.patient_id.clone(),
        health_id: entity.health_id.clone(),
        full_name: p.full_name.clone(),
        date_of_birth: p.date_of_birth.clone(),
        gender: p.gender.clone().unwrap_or_default(),
        blood_type: Some(p.emergency_info.blood_type.to_string()),
        allergies: p
            .emergency_info
            .allergies
            .iter()
            .map(|a| a.name.clone())
            .collect(),
        current_medications: p.emergency_info.current_medications.clone(),
        medical_conditions: p.emergency_info.chronic_conditions.clone(),
        emergency_contact: contact,
        content_available: true,
    }
}

/// Physician Dashboard
///
/// Returns the shape `DashboardPage` reads. It previously returned
/// `assigned_patients` carrying raw entities while the page reads
/// `patients.list` with `full_name`, so every stat card showed 0.
#[get("/api/dashboard/doctor")]
pub async fn doctor_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let current_user_id = current_user.wallet_address.clone();

    let patients: Vec<DashboardPatient> = required_dashboard_read!(
        data.repositories
            .patients
            .list(Pagination::new(0, 20))
            .await,
        "doctor dashboard patients"
    )
    .items
    .iter()
    .map(|e| dashboard_patient(e, &data.encryption_keyring))
    .collect();

    let recent_notes: Vec<_> = required_dashboard_read!(
        data.repositories
            .progress_notes
            .list_all(Pagination::new(0, 10))
            .await,
        "doctor dashboard progress notes"
    )
    .items
    .into_iter()
    .filter(|n| n.created_by == current_user_id)
    .take(10)
    .collect();

    // `lab_result_submissions`, NOT `lab_submissions`. The two names are one
    // letter apart and name different domain objects:
    //
    //   lab_submissions        a lab ORDER raised at specimen collection
    //                          (`POST /api/clinical/specimen`), whose statuses
    //                          are "collected" and friends.
    //   lab_result_submissions a RESULT awaiting clinical sign-off
    //                          (`POST /api/lab/submit`), whose statuses are
    //                          Pending / Approved / Rejected.
    //
    // This tile read the orders store and filtered it for `status == "pending"`
    // — a value that domain never produces — so `pending_lab_approvals` was
    // structurally always empty. A doctor's dashboard showed "Pending Lab
    // Reviews: 0" while eight results sat waiting for a signature, and the
    // only screen that could have contradicted it did not exist either.
    //
    // Same source and same predicate as `GET /api/lab/pending`, so the tile and
    // the review screen cannot disagree.
    let pending_labs: Vec<crate::LabResultSubmission> = required_dashboard_read!(
        data.repositories.lab_result_submissions.list_all().await,
        "doctor dashboard pending labs"
    )
    .into_iter()
    .filter_map(|r| serde_json::from_value::<crate::LabResultSubmission>(r.data).ok())
    .filter(|s| s.status == crate::LabResultStatus::Pending)
    .collect();

    let critical_values = required_dashboard_read!(
        data.repositories.critical_values.get_unacknowledged().await,
        "doctor dashboard critical values"
    );

    let code_blues = required_dashboard_read!(
        data.repositories.code_blue.list_all().await,
        "doctor dashboard code-blue events"
    );

    let active_orders = required_dashboard_read!(
        data.repositories
            .physician_orders
            .get_pending_orders()
            .await,
        "doctor dashboard active orders"
    );

    let pending_consults = required_dashboard_read!(
        data.repositories
            .consultation_notes
            .get_by_status("pending", Pagination::new(0, 10))
            .await,
        "doctor dashboard pending consults"
    )
    .items;

    HttpResponse::Ok().json(serde_json::json!({
        "role": current_user.role.to_string(),
        "physician_id": current_user_id,
        "patients": { "total": patients.len(), "list": patients },
        "pending_lab_approvals": pending_labs,
        "critical_values": critical_values,
        "recent_code_blues": code_blues,
        "active_orders": active_orders,
        "pending_consults": pending_consults,
        "recent_notes": recent_notes,
        "alerts": {
            "pending_labs_count": pending_labs.len(),
            "critical_values_count": critical_values.len(),
            "code_blues_count": code_blues.len(),
        }
    }))
}

/// Nursing Station Dashboard
///
/// Returns the shape `NurseDashboardPage` reads: it read `patients.list`,
/// `tasks.*`, `vitals_needing_attention`, `io_records` and `fall_risk_patients`
/// while the API returned `active_patients` / `pending_medications`, so every
/// card on a nurse's landing page showed zero.
/// How many medication rows the ward list shows at once.
const WARD_MEDICATION_ROWS: usize = 10;

/// Today's scheduled medications across the ward, newest patient first.
///
/// Each row carries the patient's name, the drug, the dose, the route and the
/// scheduled time — the five things a nurse needs to give a drug safely, and
/// the last three of which the previous source could not supply at all.
async fn ward_medications_due(
    data: &web::Data<AppState>,
    patients: &[DashboardPatient],
) -> Vec<serde_json::Value> {
    let today = Utc::now().date_naive();
    let mut rows: Vec<serde_json::Value> = Vec::with_capacity(WARD_MEDICATION_ROWS);

    for patient in patients {
        if rows.len() >= WARD_MEDICATION_ROWS {
            break;
        }
        let Ok(Some(record)) = data
            .repositories
            .medication_records
            .get_by_patient_and_date(&patient.patient_id, today)
            .await
        else {
            continue;
        };
        let Some(scheduled) = record.scheduled_medications.as_array() else {
            continue;
        };
        for medication in scheduled.iter().take(WARD_MEDICATION_ROWS) {
            if rows.len() >= WARD_MEDICATION_ROWS {
                break;
            }
            let field = |key: &str| {
                medication
                    .get(key)
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            };
            rows.push(serde_json::json!({
                "record_id": record.id,
                "patient_id": patient.patient_id,
                // Resolved here because the name is encrypted at rest.
                "patient_name": patient.full_name,
                "medication_name": field("medication_name").or_else(|| field("name")),
                "dosage": field("dosage").or_else(|| field("dose")),
                // Absent rather than assumed. A wrong route is a wrong drug.
                "route": field("route"),
                "scheduled_time": field("scheduled_time").or_else(|| field("time")),
                "status": field("status"),
            }));
        }
    }
    rows
}

/// The ward-orientation half of a nurse's patient list.
///
/// `NurseDashboardPage` renders bed, triage acuity and three standing tasks
/// beside every patient. `/api/dashboard/nurse` returned `DashboardPatient`,
/// which carries none of the five, so the columns were permanently blank — and
/// before that they were worse than blank: `room` had a `|| t('pending')`
/// fallback, so every bed on the ward read "Pending".
///
/// Each field has a real source. Nothing here is defaulted: a field the
/// repositories cannot answer stays `None`, and the page shows it as absent
/// rather than as a plausible value nobody recorded.
#[derive(Debug, Default, serde::Serialize)]
pub struct WardContext {
    /// Assigned bed, from the patient's most recent triage assessment.
    pub room: Option<String>,
    /// Emergency Severity Index 1-5, from the same assessment.
    pub esi_level: Option<i32>,
    /// `low` / `moderate` / `high`, from the most recent Morse Fall Scale
    /// assessment. Blank until one has been done — which is itself worth
    /// seeing, because an unassessed patient is not a low-risk one.
    pub fall_risk: Option<String>,
    /// Where the patient's live cannula is, if one is documented.
    pub iv_site: Option<String>,
    /// A wound has not been assessed within the review interval.
    pub wound_care_due: bool,
}

/// Wounds are reassessed at least daily; past this, the dressing is due.
const WOUND_REASSESSMENT_INTERVAL_HOURS: i64 = 24;

/// Gather one patient's ward context.
///
/// Four reads per patient, against a list the caller caps at fifteen. That is
/// deliberate rather than incidental: none of these repositories has a
/// ward-wide listing, and the alternative — leaving the columns empty — is what
/// this replaces. If the ward list grows, these want a batched read before the
/// page does.
async fn ward_context(data: &web::Data<AppState>, patient_id: &str) -> WardContext {
    let mut context = WardContext::default();

    if let Ok(Some(triage)) = data
        .repositories
        .triage_assessments
        .get_latest_by_patient(patient_id)
        .await
    {
        context.room = triage.assigned_bed.clone();
        context.esi_level = Some(triage.esi_level);
    }

    if let Ok(Some(fall_risk)) = data
        .repositories
        .fall_risk_assessments
        .get_latest_by_patient(patient_id)
        .await
    {
        // `None` when the row predates the scoring fix: unscored, not low risk.
        context.fall_risk = fall_risk.risk_level.clone();
    }

    // The most recently documented site that has not been discontinued. A
    // removed cannula is not an IV site, and showing one would send a nurse
    // looking for a line that is not there.
    if let Ok(sites) = data
        .repositories
        .iv_assessments
        .get_by_patient(patient_id, Pagination::new(0, 10))
        .await
    {
        context.iv_site = sites
            .items
            .iter()
            .filter(|s| s.site_discontinued != Some(true))
            .max_by_key(|s| s.assessed_at)
            .map(|s| s.site_location.clone());
    }

    if let Ok(wounds) = data
        .repositories
        .wound_assessments
        .get_by_patient(patient_id, Pagination::new(0, 10))
        .await
    {
        let cutoff = Utc::now() - chrono::Duration::hours(WOUND_REASSESSMENT_INTERVAL_HOURS);
        context.wound_care_due = wounds.items.iter().any(|w| w.assessed_at < cutoff);
    }

    context
}

#[get("/api/dashboard/nurse")]
pub async fn nurse_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let patients: Vec<DashboardPatient> = required_dashboard_read!(
        data.repositories
            .patients
            .list(Pagination::new(0, 15))
            .await,
        "nurse dashboard patients"
    )
    .items
    .iter()
    .map(|e| dashboard_patient(e, &data.encryption_keyring))
    .collect();

    // Bed, acuity and the three standing tasks, per patient. The page has
    // always rendered these columns; the endpoint has never filled them.
    let mut ward: Vec<serde_json::Value> = Vec::with_capacity(patients.len());
    let mut ivs_to_check = 0_usize;
    let mut wounds_to_assess = 0_usize;
    for patient in &patients {
        let context = ward_context(&data, &patient.patient_id).await;
        if context.iv_site.is_some() {
            ivs_to_check += 1;
        }
        if context.wound_care_due {
            wounds_to_assess += 1;
        }
        let mut value = serde_json::to_value(patient).unwrap_or(serde_json::Value::Null);
        if let (Some(obj), Ok(serde_json::Value::Object(extra))) =
            (value.as_object_mut(), serde_json::to_value(&context))
        {
            obj.extend(extra);
        }
        ward.push(value);
    }

    // Today's medication administration records for the ward, flattened into
    // the rows the round is actually worked from.
    //
    // This used to read `medication_reminders`, which is the patient-adherence
    // feature: a `MedicationReminder` has a name, a dose and a list of reminder
    // times, and no route, no scheduled time and no patient. The page rendered
    // `route: med.route || 'PO'`, so the ward medication list stated that every
    // drug was oral — including the ones given IV or IM. The MAR carries all
    // three, and it is what a drug round is.
    let medication_records = ward_medications_due(&data, &patients).await;

    let critical_alerts: Vec<_> = required_dashboard_read!(
        data.repositories
            .cds_alerts
            .list_all(Pagination::new(0, 20))
            .await,
        "nurse dashboard critical alerts"
    )
    .items
    .into_iter()
    .filter(|a| a.severity == "critical")
    .take(5)
    .collect();

    // The latest reading per patient on the ward, keeping only those flagged
    // critical: there is no ward-wide vitals listing on the repository.
    let mut vitals_needing_attention = Vec::new();
    for patient in &patients {
        let latest = required_dashboard_read!(
            data.repositories
                .vital_signs
                .get_latest_by_patient(&patient.patient_id)
                .await,
            "nurse dashboard patient vital signs"
        );
        if let Some(latest) = latest {
            if latest.is_critical {
                vitals_needing_attention.push(latest);
            }
        }
    }

    let fall_risk_patients = required_dashboard_read!(
        data.repositories
            .fall_risk_assessments
            .get_high_risk_patients()
            .await,
        "nurse dashboard fall-risk patients"
    );

    // Intake/output has no ward-wide listing; the entries a nurse records are
    // shown on the Intake & Output screen itself.
    let io_records: Vec<serde_json::Value> = Vec::new();

    HttpResponse::Ok().json(serde_json::json!({
        "nurse_id": current_user_id,
        "patients": { "total": ward.len(), "list": ward },
        "tasks": {
            "vitals_due": vitals_needing_attention.len(),
            // Counted from the same ward reads rather than hardcoded. This was
            // `0`, which is a number, and a nurse reading a task badge cannot
            // tell a real zero from a placeholder one.
            "ivs_to_check": ivs_to_check,
            "wounds_to_assess": wounds_to_assess,
        },
        "vitals_needing_attention": vitals_needing_attention,
        "fall_risk_patients": fall_risk_patients,
        "io_records": io_records,
        "medication_records": medication_records,
        "critical_alerts": critical_alerts,
    }))
}

/// Laboratory Dashboard
///
/// Returns the shape `LabTechDashboardPage` reads: it read `test_queue.pending`,
/// `qc_records`, `rejections` and `critical_notifications` while the API
/// returned `pending_work_count` / `recent_qc_logs`, so every panel was empty.
#[get("/api/dashboard/lab")]
pub async fn lab_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let submissions = required_dashboard_read!(
        data.repositories
            .lab_submissions
            .get_pending_by_priority()
            .await,
        "lab dashboard submissions"
    );

    // The queue shows a person and a test, not a row of ids: sending the raw
    // entity rendered every line as "Unknown / Unknown Test".
    let mut pending: Vec<serde_json::Value> = Vec::new();
    for submission in submissions
        .iter()
        .filter(|s| s.status != "approved" && s.status != "rejected")
    {
        let patient_name = match data
            .repositories
            .patients
            .get_by_id(&submission.patient_id)
            .await
        {
            Ok(entity) => patient_entity_to_profile(&entity, &data.encryption_keyring)
                .map(|p| p.full_name)
                .unwrap_or_else(|| submission.patient_id.clone()),
            Err(_) => submission.patient_id.clone(),
        };
        let test_name = submission
            .tests_ordered
            .as_array()
            .and_then(|tests| tests.first())
            .and_then(|t| {
                t.as_str()
                    .map(str::to_string)
                    .or_else(|| t.get("name").and_then(|n| n.as_str()).map(str::to_string))
            })
            .unwrap_or_else(|| "Unspecified test".to_string());
        pending.push(serde_json::json!({
            "id": submission.id,
            "accession_number": submission.id,
            "patient_id": submission.patient_id,
            "patient_name": patient_name,
            "test_name": test_name,
            "priority": submission.priority,
            "status": submission.status,
            "time_in_lab": submission.order_date.format("%Y-%m-%d %H:%M").to_string(),
        }));
    }
    let approved_count = submissions
        .iter()
        .filter(|s| s.status == "approved")
        .count();

    let qc_records = required_dashboard_read!(
        data.repositories.lab_qc_records.list_all().await,
        "lab dashboard quality-control records"
    );
    // A rejected specimen the technician cannot identify is unusable: the whole
    // point of the panel is to recollect, and you cannot recollect from a
    // patient you cannot name. The stored record carries `patient_id` and
    // `specimen_id`; the screen reads `patient_name` and `accession_number`,
    // neither of which exists on it, so every row rendered
    // "Unknown - Haemolysed sample / Patient: Unknown".
    //
    // Resolved here rather than in the client, for the same reason as the
    // pharmacy queue: the name is encrypted at rest and only the API holds the
    // keyring.
    let rejection_records = required_dashboard_read!(
        data.repositories.specimen_rejections.list_all().await,
        "lab dashboard specimen rejections"
    );

    let rejection_ids: Vec<String> = rejection_records
        .iter()
        .map(|r| r.patient_id.clone())
        .collect();
    let rejection_names = resolve_patient_names(&data, &rejection_ids).await;

    // Enrich the SERIALISED ENTITY, not `entity.data`.
    //
    // `SpecimenRejectionEntity` is a typed row, and its `data` field is
    // `#[sqlx(skip)]` — always JSON null for anything read from PostgreSQL. A
    // first attempt at this mapped each record to `r.data`, which put a null in
    // the array the panel maps over and took the whole Laboratory Dashboard
    // down with "Cannot read properties of null (reading 'accession_number')".
    // Worth keeping: two repositories in this file are named alike and one is
    // a JSON-document store while this one is not.
    let rejections: Vec<serde_json::Value> = rejection_records
        .iter()
        .map(|r| {
            let mut v = serde_json::to_value(r).unwrap_or(serde_json::Value::Null);
            if let Some(obj) = v.as_object_mut() {
                if let Some(name) = rejection_names.get(&r.patient_id) {
                    obj.insert(
                        "patient_name".to_string(),
                        serde_json::Value::String(name.clone()),
                    );
                }
                // The panel labels each row by accession number; this record's
                // identifier for the same specimen is `specimen_id`.
                obj.entry("accession_number".to_string())
                    .or_insert_with(|| serde_json::Value::String(r.specimen_id.clone()));
            }
            v
        })
        .collect();

    // A critical result nobody has acknowledged is the one thing on this screen
    // that must never be silently empty.
    let critical_records = required_dashboard_read!(
        data.repositories.critical_values.get_unacknowledged().await,
        "lab dashboard critical notifications"
    );

    // The same enrichment the rejections get, for the same reason and with more
    // at stake. `CriticalValueEntity` carries `patient_id` and no name — the
    // name is encrypted at rest and only the API holds the keyring — while the
    // dashboard's critical-alert banner reads `patient_name`. Every
    // unacknowledged critical result was therefore announced without saying
    // whose it was: a potassium of 7.2 on the screen, and a lab tech with no
    // way to tell who to call.
    let critical_ids: Vec<String> = critical_records
        .iter()
        .map(|c| c.patient_id.clone())
        .collect();
    let critical_names = resolve_patient_names(&data, &critical_ids).await;
    let critical_notifications: Vec<serde_json::Value> = critical_records
        .iter()
        .map(|record| {
            // The serialised entity, not `record.data` — that field is
            // `#[sqlx(skip)]` and is always null for a row read from
            // PostgreSQL, which would put a `null` in the array the banner
            // maps over and take the dashboard down.
            let mut value = serde_json::to_value(record).unwrap_or(serde_json::Value::Null);
            if let Some(obj) = value.as_object_mut() {
                if let Some(name) = critical_names.get(&record.patient_id) {
                    obj.insert(
                        "patient_name".to_string(),
                        serde_json::Value::String(name.clone()),
                    );
                }
            }
            value
        })
        .collect();
    let open_recollections = match data.repositories.specimen_recollections.list_open().await {
        Ok(values) => values,
        Err(error) => {
            log::error!("Laboratory dashboard recollection read failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The recollection queue is temporarily unavailable".to_string(),
                code: "LAB_DASHBOARD_UNAVAILABLE".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "lab_tech_id": current_user_id,
        "test_queue": {
            "pending": pending,
            "pending_count": pending.len(),
            "approved_count": approved_count,
        },
        "qc_records": qc_records,
        "rejections": rejections,
        "open_recollections": open_recollections,
        "critical_notifications": critical_notifications,
    }))
}

/// Resolve patient ids to display names, decrypting through the keyring.
///
/// Dashboards do this rather than the client for one reason: the name is
/// encrypted at rest and only the API holds the keyring, so a panel that reads
/// `patient_name` off a raw entity gets `undefined` and announces a result
/// without saying whose it is.
///
/// Ids are de-duplicated, so a patient with six unacknowledged criticals costs
/// one read rather than six. Ids that cannot be resolved are simply absent from
/// the map, and the caller leaves the field off — an unnamed alert is better
/// than one attributed to the wrong person.
async fn resolve_patient_names(
    data: &web::Data<AppState>,
    patient_ids: &[String],
) -> std::collections::HashMap<String, String> {
    let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for patient_id in patient_ids {
        if patient_id.is_empty() || names.contains_key(patient_id) {
            continue;
        }
        if let Ok(entity) = data.repositories.patients.get_by_id(patient_id).await {
            if let Some(profile) =
                crate::patient_entity_to_profile(&entity, &data.encryption_keyring)
            {
                names.insert(patient_id.clone(), profile.full_name);
            }
        }
    }
    names
}

/// Administrator Dashboard
///
/// Returns the shape `AdminDashboardPage` reads. It read a per-role staffing
/// breakdown, the recent access log, an emergency-event summary, lab throughput
/// and NFC card totals — none of which the API returned, so an administrator's
/// landing page reported zero for everything.
#[get("/api/dashboard/admin")]
pub async fn admin_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => return HttpResponse::Unauthorized().finish(),
    };
    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().finish();
    }

    let patient_count = required_dashboard_read!(
        data.repositories.patients.count().await,
        "admin dashboard patient count"
    );
    // Counted from the repository, so it survives a restart. Read from a
    // process-memory map before, which reported 0 after every deploy.
    let record_count = required_dashboard_read!(
        data.repositories.medical_records.count().await,
        "admin dashboard record count"
    );
    let tx_count = required_dashboard_read!(
        data.repositories.chain_of_custody.list_all().await,
        "admin dashboard chain-of-custody count"
    )
    .len();

    let users: Vec<crate::types::User> = data
        .users
        .read()
        .map(|guard| guard.values().cloned().collect())
        .unwrap_or_default();
    let count_role = |role: crate::types::Role| users.iter().filter(|u| u.role == role).count();

    let recent_access_logs = required_dashboard_read!(
        data.repositories
            .access_logs
            .get_by_date_range(
                crate::repositories::traits::DateRange {
                    from: Some(Utc::now() - chrono::Duration::days(7)),
                    to: Some(Utc::now()),
                },
                Pagination::new(0, 20),
            )
            .await,
        "admin dashboard access log"
    )
    .items;

    let code_blues = required_dashboard_read!(
        data.repositories.code_blue.list_all().await,
        "admin dashboard code-blue count"
    )
    .len();

    // Stroke, trauma and sepsis assessments and NFC cards are only queryable per
    // patient, so they are counted in one pass over the roster rather than
    // through a ward-wide listing these repositories do not provide.
    let mut strokes = 0usize;
    let mut traumas = 0usize;
    let mut sepsis_cases = 0usize;
    let mut nfc_cards = Vec::new();
    let roster = required_dashboard_read!(
        data.repositories
            .patients
            .list(Pagination::new(0, 100))
            .await,
        "admin dashboard patient roster"
    );
    for entity in roster.items {
        strokes += required_dashboard_read!(
            data.repositories
                .stroke_assessments_repo
                .get_by_patient(&entity.id, Pagination::new(0, 100))
                .await,
            "admin dashboard stroke assessments"
        )
        .items
        .len();
        traumas += required_dashboard_read!(
            data.repositories
                .trauma_assessments_repo
                .get_by_patient(&entity.id, Pagination::new(0, 100))
                .await,
            "admin dashboard trauma assessments"
        )
        .items
        .len();
        sepsis_cases += required_dashboard_read!(
            data.repositories
                .sepsis_assessments_repo
                .get_by_patient(&entity.id, Pagination::new(0, 100))
                .await,
            "admin dashboard sepsis assessments"
        )
        .items
        .len();
        nfc_cards.extend(required_dashboard_read!(
            data.repositories.nfc_tags.get_by_patient(&entity.id).await,
            "admin dashboard NFC cards"
        ));
    }

    let submissions = required_dashboard_read!(
        data.repositories
            .lab_submissions
            .get_pending_by_priority()
            .await,
        "admin dashboard lab submissions"
    );
    let labs_pending = submissions.iter().filter(|s| s.status == "pending").count();
    let labs_approved = submissions
        .iter()
        .filter(|s| s.status == "approved")
        .count();

    // This used to report `status: "healthy", peers: 4, best_block: 12450,
    // finalized_block: 12445` as literals — an administrator's node-health
    // panel that showed a healthy, syncing chain even with no node configured
    // at all. The client exposes connection readiness and nothing else, so
    // that is all this reports; peer count and block heights are null rather
    // than invented, and an operator can tell the difference between "not
    // configured", "unreachable" and "connected".
    let node_status = serde_json::json!({
        "status": if !crate::blockchain::blockchain_enabled() {
            "disabled"
        } else if data
            .substrate_client
            .as_ref()
            .is_some_and(|client| client.is_ready())
        {
            "connected"
        } else {
            "unavailable"
        },
        "peers": serde_json::Value::Null,
        "best_block": serde_json::Value::Null,
        "finalized_block": serde_json::Value::Null
    });

    HttpResponse::Ok().json(serde_json::json!({
        "admin_id": current_user_id,
        "system_stats": {
            "total_patients": patient_count,
            "total_records": record_count,
            "total_blockchain_transactions": tx_count,
            "total_users": users.len(),
            "doctors": count_role(crate::types::Role::Doctor),
            "nurses": count_role(crate::types::Role::Nurse),
            "lab_technicians": count_role(crate::types::Role::LabTechnician),
            "pharmacists": count_role(crate::types::Role::Pharmacist),
            "patient_users": count_role(crate::types::Role::Patient),
        },
        "recent_access_logs": recent_access_logs,
        "emergency_events": {
            "total": code_blues + strokes + traumas + sepsis_cases,
            "code_blues": code_blues,
            "strokes": strokes,
            "traumas": traumas,
            "sepsis_cases": sepsis_cases,
        },
        "lab_submissions": {
            "total": submissions.len(),
            "pending": labs_pending,
            "approved": labs_approved,
        },
        "nfc_cards": {
            "total": nfc_cards.len(),
            "cards": nfc_cards,
        },
        "node_status": node_status
    }))
}

/// The interactions a stored drug-interaction check found, in the shape the
/// pharmacy dashboard renders. `Contraindicated` is shown as `Major`: the page
/// has three bands and a contraindication belongs in the most severe of them.
fn check_interaction_rows(
    check: &crate::repositories::traits::JsonRecordEntity,
    patient_id: &str,
    patient_name: Option<&str>,
) -> Vec<serde_json::Value> {
    let Ok(result) =
        serde_json::from_value::<crate::clinical::DrugInteractionResult>(check.data.clone())
    else {
        return Vec::new();
    };
    result
        .interactions
        .iter()
        .enumerate()
        .filter_map(|(index, interaction)| {
            use crate::clinical::InteractionSeverity as S;
            let severity = match interaction.severity {
                S::Contraindicated | S::Major => "Major",
                S::Moderate => "Moderate",
                S::Minor => "Minor",
                S::None => return None,
            };
            Some(serde_json::json!({
                "id": format!("{}-{index}", result.result_id),
                "drug1": interaction.drug_a,
                "drug2": interaction.drug_b,
                "severity": severity,
                "description": interaction.description,
                "patient_id": patient_id,
                "patient_name": patient_name,
            }))
        })
        .collect()
}

/// Pharmacy Dashboard
///
/// Returns the shape `PharmacistDashboardPage` reads: it read
/// `prescriptions.list`, `drug_interactions` and `allergy_alerts` while the API
/// returned `pending_fills`, so the queue and both safety panels were empty.
#[get("/api/dashboard/pharmacist")]
pub async fn pharmacist_dashboard(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let records = required_dashboard_read!(
        data.repositories.e_prescriptions_v2.list_all().await,
        "pharmacy dashboard prescriptions"
    );
    // Flattened for the queue table, which reads `medication_name`, `dosage`,
    // `patient_name` and `priority` directly. The stored document nests the drug
    // under `medication`, so passing it through raw threw on
    // `rx.medication_name.toLowerCase()` and took the page down.
    let text = |v: &serde_json::Value, key: &str| {
        v.get(key)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    };
    // `EPrescription` has no `patient_name` field — it carries `patient_id` and
    // nothing else about the patient — so reading one out of the stored
    // document always produced "". The queue fell back to showing a raw
    // identifier, and a pharmacist verifying an order against an allergy list
    // was reading `PAT-6381aba1` where a name belongs.
    //
    // Resolved once per distinct patient rather than once per prescription: a
    // patient with eight prescriptions in the queue is one lookup, and the
    // name is encrypted at rest so each lookup costs a decrypt.
    let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for r in &records {
        let pid = text(&r.data, "patient_id");
        if pid.is_empty() || names.contains_key(&pid) {
            continue;
        }
        match data.repositories.patients.get_by_id(&pid).await {
            Ok(entity) => {
                if let Some(profile) =
                    crate::patient_entity_to_profile(&entity, &data.encryption_keyring)
                {
                    names.insert(pid, profile.full_name);
                }
            }
            // Older prescription fixtures can legitimately outlive a removed
            // synthetic patient; the row still carries its patient id.
            Err(RepositoryError::NotFound(_)) => {}
            Err(error) => {
                log::error!("Pharmacy dashboard patient identity read failed: {error}");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    error: "Dashboard data is temporarily unavailable".to_string(),
                    code: "DASHBOARD_DATA_UNAVAILABLE".to_string(),
                });
            }
        }
    }

    let list: Vec<serde_json::Value> = records
        .iter()
        .map(|r| {
            let v = &r.data;
            let med = v
                .get("medication")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let patient_id = text(v, "patient_id");
            serde_json::json!({
                "prescription_id": text(v, "prescription_id"),
                "patient_id": patient_id,
                // Falls back to the stored value only so an older document that
                // did carry a name is not discarded.
                "patient_name": names
                    .get(&text(v, "patient_id"))
                    .cloned()
                    .unwrap_or_else(|| text(v, "patient_name")),
                "prescriber_name": text(v, "prescriber_name"),
                "medication_name": text(&med, "name"),
                "dosage": text(&med, "strength"),
                "directions": text(&med, "directions"),
                "status": text(v, "status"),
                // `quantity` lives on the MEDICATION, beside `strength` and
                // `directions` which this same block already reads from there.
                // Reading it from the top level returned 0 for every
                // prescription ever written, so the pharmacy queue told the
                // pharmacist to dispense none of a drug that had been
                // prescribed thirty of.
                "prescribed_quantity": med
                    .get("quantity")
                    .or_else(|| v.get("quantity"))
                    .and_then(|q| q.as_u64())
                    .unwrap_or(0),
                "dispensed_quantity": v.get("dispensed_quantity").and_then(|q| q.as_u64()).unwrap_or(0),
                "priority": if v.get("is_controlled").and_then(|c| c.as_bool()).unwrap_or(false) {
                    "STAT"
                } else {
                    "Routine"
                },
                "is_controlled": v.get("is_controlled").and_then(|c| c.as_bool()).unwrap_or(false),
                "secondary_verification": v.get("secondary_verification")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({
                        "required": false,
                        "status": "NotRequired"
                    })),
            })
        })
        .collect();
    let status_of = |v: &serde_json::Value| {
        v.get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string()
    };
    // Only a transmitted prescription has reached the pharmacy; a draft sitting
    // in a prescriber's screen is not pharmacy work.
    let pending_fill = list
        .iter()
        .filter(|v| status_of(v) == "Transmitted")
        .count();
    // `PrescriptionStatus` has no `Filling` and no `Filled`. Its variants are
    // Draft, Pending, Signed, Transmitted, Received, InProgress, Dispensed,
    // PartialFill, Cancelled, Expired, Error — so both of these tiles were
    // filtering on strings the domain never produces and were structurally
    // always zero, exactly like the doctor's "Pending Lab Reviews" tile was.
    //
    // The lifecycle endpoints now drive these states; keeping the predicate in
    // terms of the domain tokens prevents the tiles drifting from that state
    // machine again.
    let in_progress = list
        .iter()
        .filter(|v| matches!(status_of(v).as_str(), "Received" | "InProgress"))
        .count();
    let completed_today = list
        .iter()
        .filter(|v| matches!(status_of(v).as_str(), "Dispensed" | "PartialFill"))
        .count();

    let mut drug_interactions = Vec::new();
    let mut allergy_alerts = Vec::new();
    let safety_roster = required_dashboard_read!(
        data.repositories
            .patients
            .list(Pagination::new(0, 50))
            .await,
        "pharmacy dashboard safety roster"
    );
    for entity in safety_roster.items {
        let profile = patient_entity_to_profile(&entity, &data.encryption_keyring);
        let patient_name = profile.as_ref().map(|p| p.full_name.clone());
        // The interactions found by the latest check a prescriber ran for this
        // patient. This read `drug_interactions`, a table nothing writes, so
        // the panel and the critical banner above it were empty for every
        // pharmacy -- and its rows carried `drug1_name`, where the page reads
        // `drug1`. The checks prescribers run are filed in
        // `drug_interaction_checks`, newest first.
        let checks = required_dashboard_read!(
            data.repositories
                .drug_interaction_checks
                .get_by_owner(&entity.id)
                .await,
            "pharmacy dashboard drug interactions"
        );
        if let Some(latest) = checks.into_iter().next() {
            drug_interactions.extend(check_interaction_rows(
                &latest,
                &entity.id,
                patient_name.as_deref(),
            ));
        }
        // An allergy the pharmacy should see before dispensing.
        if let Some(profile) = profile {
            for (index, allergy) in profile.emergency_info.allergies.iter().enumerate() {
                allergy_alerts.push(serde_json::json!({
                    "id": format!("ALG-{}-{index}", profile.patient_id),
                    "patient_id": profile.patient_id,
                    "patient_name": profile.full_name,
                    "allergen": allergy.name,
                    "severity": allergy.severity.to_string(),
                    "reaction": allergy.reaction,
                }));
            }
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "pharmacist_id": current_user_id,
        "prescriptions": {
            "list": list,
            "pending_fill": pending_fill,
            "in_progress": in_progress,
            "completed_today": completed_today,
        },
        "drug_interactions": drug_interactions,
        "allergy_alerts": allergy_alerts,
    }))
}

#[cfg(test)]
mod lab_rejection_tests {
    use super::*;
    use actix_web::{test, App};

    fn lab_tech() -> crate::User {
        crate::User {
            wallet_address: "lab_wallet".to_string(),
            username: None,
            name: "Lab Test".to_string(),
            role: crate::Role::LabTechnician,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// A rejected specimen the technician cannot identify is unusable: the
    /// panel exists so somebody can recollect, and you cannot recollect from a
    /// patient you cannot name.
    ///
    /// The stored record carries `patient_id` and `specimen_id`; the screen
    /// reads `patient_name` and `accession_number`, neither of which exists on
    /// `SpecimenRejectionEntity`. Every row rendered
    /// "Unknown - Haemolysed sample / Patient: Unknown".
    #[actix_web::test]
    async fn a_rejected_specimen_identifies_its_patient_and_specimen() {
        let state = crate::AppState::new();
        state
            .users
            .write()
            .unwrap()
            .insert("lab_wallet".to_string(), lab_tech());

        let patient_id = "PAT-REJ-1";
        let now = chrono::Utc::now();

        let profile = crate::PatientProfile {
            patient_id: patient_id.to_string(),
            full_name: "Thandiwe Rejection-Test".to_string(),
            date_of_birth: "1990-01-01".to_string(),
            time_of_birth: None,
            national_id: "NID-REJ-1".to_string(),
            gender: None,
            phone: "+27000000300".to_string(),
            emergency_info: crate::EmergencyInfo {
                patient_id: patient_id.to_string(),
                blood_type: crate::BloodType::OPositive,
                allergies: Vec::new(),
                current_medications: Vec::new(),
                chronic_conditions: Vec::new(),
                emergency_contacts: Vec::new(),
                organ_donor: false,
                dnr_status: false,
                dnr_verified_by: None,
                dnr_verified_at: None,
                dnr_document_ref: None,
                languages: vec!["en".to_string()],
                last_updated: now,
            },
            address: None,
            insurance: None,
            primary_doctor: None,
            community_health_worker: None,
            preferences: crate::PatientPreferences::default(),
            advanced_directives: Vec::new(),
            family_notifications: None,
            created_at: now,
            last_updated: now,
        };
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &profile,
                &state.encryption_keyring,
            ))
            .await
            .expect("seed patient");

        state
            .repositories
            .specimen_rejections
            .create(crate::repositories::traits::SpecimenRejectionEntity {
                id: "REJ-1".to_string(),
                specimen_id: "SPC-REJ-1".to_string(),
                patient_id: patient_id.to_string(),
                rejection_reason: "Haemolysed sample".to_string(),
                rejection_category: "collection_error".to_string(),
                detailed_notes: None,
                rejected_by: "lab_wallet".to_string(),
                rejected_at: now,
                recollection_required: false,
                recollection_scheduled: None,
                notified_ordering_provider: false,
                notification_sent_at: None,
                created_at: now,
                data: serde_json::Value::Null,
            })
            .await
            .expect("seed rejection");

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(lab_dashboard),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/dashboard/lab")
                .insert_header(("x-user-id", "lab_wallet"))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        let rejections = body["rejections"].as_array().expect("rejections array");
        assert_eq!(rejections.len(), 1, "got {body}");

        // Every element must be an object. An earlier version of this
        // enrichment emitted `entity.data` — which is `#[sqlx(skip)]` and so
        // always null — and the panel died on
        // "Cannot read properties of null".
        assert!(rejections[0].is_object(), "a null here takes the page down");
        assert_eq!(rejections[0]["patient_name"], "Thandiwe Rejection-Test");
        assert_eq!(rejections[0]["accession_number"], "SPC-REJ-1");
    }
}

#[cfg(test)]
mod pharmacy_tile_tests {
    use super::*;
    use actix_web::{test, App};

    fn pharmacist() -> crate::User {
        crate::User {
            wallet_address: "tile_pharm".to_string(),
            username: None,
            name: "Tile Pharm".to_string(),
            role: crate::Role::Pharmacist,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// The pharmacy tiles must count statuses `PrescriptionStatus` can actually
    /// produce.
    ///
    /// `in_progress` filtered on `"Filling"` and `completed_today` on
    /// `"Filled"`. Neither is a variant — the enum has Draft, Pending, Signed,
    /// Transmitted, Received, InProgress, Dispensed, PartialFill, Cancelled,
    /// Expired, Error — so both tiles were structurally always zero and no test
    /// data could have moved them, exactly like the doctor's "Pending Lab
    /// Reviews" tile before it was fixed.
    #[actix_web::test]
    async fn the_pharmacy_tiles_count_statuses_the_domain_produces() {
        let state = crate::AppState::new();
        state
            .users
            .write()
            .unwrap()
            .insert("tile_pharm".to_string(), pharmacist());

        let now = chrono::Utc::now();
        // One of each state the tiles are supposed to notice, plus a
        // Transmitted one for the pending queue.
        for (id, status) in [
            ("RX-T1", "Transmitted"),
            ("RX-R1", "Received"),
            ("RX-I1", "InProgress"),
            ("RX-D1", "Dispensed"),
            ("RX-P1", "PartialFill"),
        ] {
            state
                .repositories
                .e_prescriptions_v2
                .create(crate::repositories::traits::JsonRecordEntity {
                    id: id.to_string(),
                    owner_id: "PAT-TILE".to_string(),
                    data: serde_json::json!({
                        "prescription_id": id,
                        "patient_id": "PAT-TILE",
                        "prescriber_name": "Dr Tile",
                        "medication": { "name": "Amoxicillin", "strength": "500mg", "directions": "tds" },
                        "status": status,
                        "is_controlled": false,
                    }),
                    created_at: now,
                    updated_at: now,
                })
                .await
                .expect("seed prescription");
        }

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(pharmacist_dashboard),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/dashboard/pharmacist")
                .insert_header(("x-user-id", "tile_pharm"))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        let rx = &body["prescriptions"];

        assert_eq!(
            rx["pending_fill"], 1,
            "one Transmitted prescription; got {body}"
        );
        assert_eq!(
            rx["in_progress"], 2,
            "Received + InProgress are the states between transmission and dispensing; got {body}"
        );
        assert_eq!(
            rx["completed_today"], 2,
            "Dispensed + PartialFill are the terminal dispensing states; got {body}"
        );
    }
}

#[cfg(test)]
mod pharmacy_queue_tests {
    use super::*;
    use actix_web::{test, App};

    fn pharmacist() -> crate::User {
        crate::User {
            wallet_address: "pharm_wallet".to_string(),
            username: None,
            name: "Pharm Test".to_string(),
            role: crate::Role::Pharmacist,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// A pharmacist verifying an order against an allergy list needs to know
    /// whose order it is.
    ///
    /// The queue mapped `patient_name` out of the stored prescription
    /// document, and `EPrescription` has no such field — it carries
    /// `patient_id` and nothing else about the patient. Every row therefore
    /// carried an empty name and the table fell back to a raw identifier.
    #[actix_web::test]
    async fn the_queue_names_the_patient_rather_than_showing_an_id() {
        let state = crate::AppState::new();
        state
            .users
            .write()
            .unwrap()
            .insert("pharm_wallet".to_string(), pharmacist());

        let patient_id = "PAT-PHARM-1";
        let now = chrono::Utc::now();

        // A real patient, stored the way the product stores one: encrypted.
        let profile = crate::PatientProfile {
            patient_id: patient_id.to_string(),
            full_name: "Thandiwe Pharmacy-Test".to_string(),
            date_of_birth: "1988-04-12".to_string(),
            time_of_birth: None,
            national_id: "NID-PHARM-1".to_string(),
            gender: None,
            phone: "+27000000100".to_string(),
            emergency_info: crate::EmergencyInfo {
                patient_id: patient_id.to_string(),
                blood_type: crate::BloodType::OPositive,
                // Allergies are irrelevant to this assertion; an empty
                // list keeps the fixture to the fields under test.
                allergies: Vec::new(),
                current_medications: Vec::new(),
                chronic_conditions: Vec::new(),
                emergency_contacts: Vec::new(),
                organ_donor: false,
                dnr_status: false,
                dnr_verified_by: None,
                dnr_verified_at: None,
                dnr_document_ref: None,
                languages: vec!["en".to_string()],
                last_updated: now,
            },
            address: None,
            insurance: None,
            primary_doctor: None,
            community_health_worker: None,
            preferences: crate::PatientPreferences::default(),
            advanced_directives: Vec::new(),
            family_notifications: None,
            created_at: now,
            last_updated: now,
        };
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &profile,
                &state.encryption_keyring,
            ))
            .await
            .expect("seed patient");

        // Two prescriptions for that one patient, so the per-patient
        // resolution is exercised rather than a one-row coincidence.
        for rx in ["RX-P1", "RX-P2"] {
            state
                .repositories
                .e_prescriptions_v2
                .create(crate::repositories::traits::JsonRecordEntity {
                    id: rx.to_string(),
                    owner_id: patient_id.to_string(),
                    data: serde_json::json!({
                        "prescription_id": rx,
                        "patient_id": patient_id,
                        "prescriber_name": "Dr Test",
                        "medication": { "name": "Amoxicillin", "strength": "500mg", "directions": "tds" },
                        "status": "Transmitted",
                        "is_controlled": false,
                    }),
                    created_at: now,
                    updated_at: now,
                })
                .await
                .expect("seed prescription");
        }

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(pharmacist_dashboard),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/dashboard/pharmacist")
                .insert_header(("x-user-id", "pharm_wallet"))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        let text = body.to_string();
        assert!(
            text.contains("Thandiwe Pharmacy-Test"),
            "the queue must carry the patient's name, got {text}"
        );
    }
}

#[cfg(test)]
mod pending_lab_tile_tests {
    use super::*;
    use actix_web::{test, App};

    fn doctor() -> crate::User {
        crate::User {
            wallet_address: "dash_doctor".to_string(),
            username: None,
            name: "Dr Dashboard".to_string(),
            role: crate::Role::Doctor,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    fn submission(id: &str, status: crate::LabResultStatus) -> crate::LabResultSubmission {
        crate::LabResultSubmission {
            id: id.to_string(),
            patient_id: "PAT-DASH".to_string(),
            patient_name: "Dash Patient".to_string(),
            test_name: "Full Blood Count".to_string(),
            test_category: "Hematology".to_string(),
            results: Vec::new(),
            notes: None,
            submitted_by: "lab_tech".to_string(),
            submitted_at: chrono::Utc::now(),
            status,
            reviewed_by: None,
            reviewed_at: None,
            rejection_reason: None,
            content_hash: None,
            metadata_hash: None,
        }
    }

    /// The doctor dashboard's "Pending Lab Reviews" tile must count the results
    /// waiting for a signature.
    ///
    /// It used to read `lab_submissions` — the lab *order* store written at
    /// specimen collection, whose statuses are "collected" and friends — and
    /// filter it for `status == "pending"`. That value never occurs there, so
    /// the tile was structurally always zero: it showed 0 while results sat
    /// waiting, and no amount of test data could have made it show anything
    /// else.
    #[actix_web::test]
    async fn the_tile_counts_results_awaiting_signature() {
        let state = crate::AppState::new();
        state
            .users
            .write()
            .unwrap()
            .insert("dash_doctor".to_string(), doctor());

        let now = chrono::Utc::now();
        for (id, status) in [
            ("LAB-P1", crate::LabResultStatus::Pending),
            ("LAB-P2", crate::LabResultStatus::Pending),
            ("LAB-A1", crate::LabResultStatus::Approved),
            ("LAB-R1", crate::LabResultStatus::Rejected),
        ] {
            let s = submission(id, status);
            state
                .repositories
                .lab_result_submissions
                .create(crate::repositories::traits::JsonRecordEntity {
                    id: s.id.clone(),
                    owner_id: s.patient_id.clone(),
                    data: serde_json::to_value(&s).unwrap(),
                    created_at: now,
                    updated_at: now,
                })
                .await
                .unwrap();
        }

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(doctor_dashboard),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/dashboard/doctor")
                .insert_header(("x-user-id", "dash_doctor"))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        let pending = body["pending_lab_approvals"]
            .as_array()
            .expect("pending_lab_approvals should be an array");

        assert_eq!(
            pending.len(),
            2,
            "only the two Pending results count; got {body}"
        );
        assert_eq!(body["alerts"]["pending_labs_count"], 2);

        let ids: Vec<&str> = pending.iter().filter_map(|s| s["id"].as_str()).collect();
        assert!(
            ids.contains(&"LAB-P1") && ids.contains(&"LAB-P2"),
            "got {ids:?}"
        );
    }
}

/// The interaction panel shows what prescribers' checks actually found.
#[cfg(test)]
mod pharmacy_interaction_panel_tests {
    use crate::test_fixtures::{patient_profile, register};
    use crate::Role;
    use actix_web::{test, web, App};

    #[actix_web::test]
    async fn a_filed_interaction_check_reaches_the_pharmacy_panel() {
        let state = crate::AppState::new();
        register(&state, "5Pharm", Role::Pharmacist);
        let mut profile = patient_profile("PAT-INT-1", "Naledi Dube");
        profile.emergency_info.allergies = vec![crate::Allergy {
            name: "Penicillin".to_string(),
            severity: crate::AllergySeverity::Unknown,
            reaction: None,
            verified_at: None,
        }];
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &profile,
                &state.encryption_keyring,
            ))
            .await
            .expect("seed patient");

        let now = chrono::Utc::now();
        let result = crate::clinical::DrugInteractionResult {
            result_id: "CHK-INT-1".to_string(),
            patient_id: "PAT-INT-1".to_string(),
            checked_at: now.timestamp(),
            new_medication: "warfarin".to_string(),
            interactions: vec![crate::clinical::DrugInteraction {
                drug_a: "warfarin".to_string(),
                drug_b: "aspirin".to_string(),
                severity: crate::clinical::InteractionSeverity::Major,
                description: "Additive bleeding risk".to_string(),
                clinical_effects: String::new(),
                management: String::new(),
                evidence_level: crate::clinical::EvidenceLevel::Established,
                source: String::new(),
            }],
            overall_severity: crate::clinical::InteractionSeverity::Major,
            safe_to_prescribe: false,
            checked_by: "5Doctor".to_string(),
        };
        state
            .repositories
            .drug_interaction_checks
            .create(crate::repositories::traits::JsonRecordEntity {
                id: "CHK-INT-1".to_string(),
                owner_id: "PAT-INT-1".to_string(),
                data: serde_json::to_value(&result).expect("serialize"),
                created_at: now,
                updated_at: now,
            })
            .await
            .expect("file check");

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(super::pharmacist_dashboard),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/dashboard/pharmacist")
            .insert_header(("X-User-Id", "5Pharm"))
            .to_request();
        let body: serde_json::Value = test::call_and_read_body_json(&app, req).await;

        let panel = body["drug_interactions"].as_array().expect("panel");
        assert_eq!(panel.len(), 1, "{body}");
        assert_eq!(panel[0]["drug1"], "warfarin", "{body}");
        assert_eq!(panel[0]["drug2"], "aspirin", "{body}");
        assert_eq!(panel[0]["severity"], "Major", "{body}");
        assert_eq!(panel[0]["patient_name"], "Naledi Dube", "{body}");
        let allergy = &body["allergy_alerts"][0];
        assert_eq!(allergy["allergen"], "Penicillin", "{body}");
        assert!(allergy["id"].is_string(), "a row the page can key: {body}");
    }
}
