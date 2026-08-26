use super::*;

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
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Get patient profile from repository
    let patient_profile = data
        .repositories
        .patients
        .get_by_id(&current_user_id)
        .await
        .ok();

    // Get recent lab results (approved only for patients) from repository
    let pagination = Pagination::new(0, 10);
    let lab_results: Vec<_> = match data
        .repositories
        .lab_submissions
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result
            .items
            .into_iter()
            .filter(|s| current_user.role.can_view_medical_records() || s.status == "approved")
            .collect(),
        Err(_) => Vec::new(),
    };

    // Get medical records from repository
    let pagination = Pagination::new(0, 50);
    let medical_records: Vec<_> = match data
        .repositories
        .medical_records
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get latest vital signs from repository
    let vital_signs = data
        .repositories
        .vital_signs
        .get_latest_by_patient(&current_user_id)
        .await
        .unwrap_or_default();

    // Get SOAP notes (Progress notes) from repository
    let pagination = Pagination::new(0, 5);
    let soap_notes: Vec<_> = match data
        .repositories
        .progress_notes
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get triage assessments from repository
    let pagination = Pagination::new(0, 5);
    let triage_history: Vec<_> = match data
        .repositories
        .triage_assessments
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "user_id": current_user_id,
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

    let patients: Vec<DashboardPatient> = data
        .repositories
        .patients
        .list(Pagination::new(0, 20))
        .await
        .map(|r| r.items)
        .unwrap_or_default()
        .iter()
        .map(|e| dashboard_patient(e, &data.encryption_keyring))
        .collect();

    let recent_notes: Vec<_> = data
        .repositories
        .progress_notes
        .list_all(Pagination::new(0, 10))
        .await
        .map(|r| r.items)
        .unwrap_or_default()
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
    let pending_labs: Vec<crate::LabResultSubmission> = data
        .repositories
        .lab_result_submissions
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::LabResultSubmission>(r.data).ok())
        .filter(|s| s.status == crate::LabResultStatus::Pending)
        .collect();

    let critical_values = data
        .repositories
        .critical_values
        .get_unacknowledged()
        .await
        .unwrap_or_default();

    let code_blues = data
        .repositories
        .code_blue
        .list_all()
        .await
        .unwrap_or_default();

    let active_orders = data
        .repositories
        .physician_orders
        .get_pending_orders()
        .await
        .unwrap_or_default();

    let pending_consults = data
        .repositories
        .consultation_notes
        .get_by_status("pending", Pagination::new(0, 10))
        .await
        .map(|r| r.items)
        .unwrap_or_default();

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
#[get("/api/dashboard/nurse")]
pub async fn nurse_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let patients: Vec<DashboardPatient> = data
        .repositories
        .patients
        .list(Pagination::new(0, 15))
        .await
        .map(|r| r.items)
        .unwrap_or_default()
        .iter()
        .map(|e| dashboard_patient(e, &data.encryption_keyring))
        .collect();

    let medication_records: Vec<_> = data
        .repositories
        .medication_reminders
        .list_all_active()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|m| m.is_active)
        .take(10)
        .collect();

    let critical_alerts: Vec<_> = data
        .repositories
        .cds_alerts
        .list_all(Pagination::new(0, 20))
        .await
        .map(|r| r.items)
        .unwrap_or_default()
        .into_iter()
        .filter(|a| a.severity == "critical")
        .take(5)
        .collect();

    // The latest reading per patient on the ward, keeping only those flagged
    // critical: there is no ward-wide vitals listing on the repository.
    let mut vitals_needing_attention = Vec::new();
    for patient in &patients {
        if let Ok(Some(latest)) = data
            .repositories
            .vital_signs
            .get_latest_by_patient(&patient.patient_id)
            .await
        {
            if latest.is_critical {
                vitals_needing_attention.push(latest);
            }
        }
    }

    let fall_risk_patients = data
        .repositories
        .fall_risk_assessments
        .get_high_risk_patients()
        .await
        .unwrap_or_default();

    // Intake/output has no ward-wide listing; the entries a nurse records are
    // shown on the Intake & Output screen itself.
    let io_records: Vec<serde_json::Value> = Vec::new();

    HttpResponse::Ok().json(serde_json::json!({
        "nurse_id": current_user_id,
        "patients": { "total": patients.len(), "list": patients },
        "tasks": {
            "vitals_due": vitals_needing_attention.len(),
            "ivs_to_check": 0,
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

    let submissions = data
        .repositories
        .lab_submissions
        .get_pending_by_priority()
        .await
        .unwrap_or_default();

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

    let qc_records = data
        .repositories
        .lab_qc_records
        .list_all()
        .await
        .unwrap_or_default();
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
    let rejection_records = data
        .repositories
        .specimen_rejections
        .list_all()
        .await
        .unwrap_or_default();

    let mut rejection_names: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for r in &rejection_records {
        if r.patient_id.is_empty() || rejection_names.contains_key(&r.patient_id) {
            continue;
        }
        if let Ok(entity) = data.repositories.patients.get_by_id(&r.patient_id).await {
            if let Some(profile) =
                crate::patient_entity_to_profile(&entity, &data.encryption_keyring)
            {
                rejection_names.insert(r.patient_id.clone(), profile.full_name);
            }
        }
    }

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
    let critical_notifications = data
        .repositories
        .critical_values
        .get_unacknowledged()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "lab_tech_id": current_user_id,
        "test_queue": {
            "pending": pending,
            "pending_count": pending.len(),
            "approved_count": approved_count,
        },
        "qc_records": qc_records,
        "rejections": rejections,
        "critical_notifications": critical_notifications,
    }))
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

    let patient_count = data.repositories.patients.count().await.unwrap_or(0);
    // Counted from the repository, so it survives a restart. Read from a
    // process-memory map before, which reported 0 after every deploy.
    let record_count = data.repositories.medical_records.count().await.unwrap_or(0);
    let tx_count = data
        .repositories
        .chain_of_custody
        .list_all()
        .await
        .unwrap_or_default()
        .len();

    let users: Vec<crate::types::User> = data
        .users
        .read()
        .map(|guard| guard.values().cloned().collect())
        .unwrap_or_default();
    let count_role = |role: crate::types::Role| users.iter().filter(|u| u.role == role).count();

    let recent_access_logs = data
        .repositories
        .access_logs
        .get_by_date_range(
            crate::repositories::traits::DateRange {
                from: Some(Utc::now() - chrono::Duration::days(7)),
                to: Some(Utc::now()),
            },
            Pagination::new(0, 20),
        )
        .await
        .map(|r| r.items)
        .unwrap_or_default();

    let code_blues = data
        .repositories
        .code_blue
        .list_all()
        .await
        .unwrap_or_default()
        .len();

    // Stroke, trauma and sepsis assessments and NFC cards are only queryable per
    // patient, so they are counted in one pass over the roster rather than
    // through a ward-wide listing these repositories do not provide.
    let mut strokes = 0usize;
    let mut traumas = 0usize;
    let mut sepsis_cases = 0usize;
    let mut nfc_cards = Vec::new();
    for entity in data
        .repositories
        .patients
        .list(Pagination::new(0, 100))
        .await
        .map(|r| r.items)
        .unwrap_or_default()
    {
        if let Ok(result) = data
            .repositories
            .stroke_assessments_repo
            .get_by_patient(&entity.id, Pagination::new(0, 100))
            .await
        {
            strokes += result.items.len();
        }
        if let Ok(result) = data
            .repositories
            .trauma_assessments_repo
            .get_by_patient(&entity.id, Pagination::new(0, 100))
            .await
        {
            traumas += result.items.len();
        }
        if let Ok(result) = data
            .repositories
            .sepsis_assessments_repo
            .get_by_patient(&entity.id, Pagination::new(0, 100))
            .await
        {
            sepsis_cases += result.items.len();
        }
        if let Ok(tags) = data.repositories.nfc_tags.get_by_patient(&entity.id).await {
            nfc_cards.extend(tags);
        }
    }

    let submissions = data
        .repositories
        .lab_submissions
        .get_pending_by_priority()
        .await
        .unwrap_or_default();
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

    let records = data
        .repositories
        .e_prescriptions_v2
        .list_all()
        .await
        .unwrap_or_default();
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
        if let Ok(entity) = data.repositories.patients.get_by_id(&pid).await {
            if let Some(profile) =
                crate::patient_entity_to_profile(&entity, &data.encryption_keyring)
            {
                names.insert(pid, profile.full_name);
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
                "priority": if v.get("is_controlled").and_then(|c| c.as_bool()).unwrap_or(false) {
                    "STAT"
                } else {
                    "Routine"
                },
                "is_controlled": v.get("is_controlled").and_then(|c| c.as_bool()).unwrap_or(false),
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
    let in_progress = list.iter().filter(|v| status_of(v) == "Filling").count();
    let completed_today = list.iter().filter(|v| status_of(v) == "Filled").count();

    let mut drug_interactions = Vec::new();
    let mut allergy_alerts = Vec::new();
    for entity in data
        .repositories
        .patients
        .list(Pagination::new(0, 50))
        .await
        .map(|r| r.items)
        .unwrap_or_default()
    {
        if let Ok(items) = data
            .repositories
            .drug_interactions
            .get_unacknowledged(&entity.id)
            .await
        {
            drug_interactions.extend(items);
        }
        // An allergy the pharmacy should see before dispensing.
        if let Some(profile) = patient_entity_to_profile(&entity, &data.encryption_keyring) {
            for allergy in &profile.emergency_info.allergies {
                allergy_alerts.push(serde_json::json!({
                    "patient_id": profile.patient_id,
                    "patient_name": profile.full_name,
                    "allergen": allergy.name,
                    "severity": format!("{:?}", allergy.severity),
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
