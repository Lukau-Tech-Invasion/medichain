//! `clinical_endpoints::fhir::clinical_resources` — HL7 FHIR R4 Observation/Encounter/
//! DiagnosticReport resource endpoints.
//!
//! Split out of the former single-file `fhir.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `fhir/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Builds the FHIR `Observation` bundle entries for one vital-signs reading:
/// heart rate, blood pressure (systolic+diastolic components), and oxygen
/// saturation — each only emitted when that reading actually has a value.
fn vital_signs_observation_entries(
    reading: &crate::clinical::VitalSignsReading,
    patient_id: &str,
) -> Vec<serde_json::Value> {
    let mut entries: Vec<serde_json::Value> = Vec::new();
    let effective_time =
        chrono::DateTime::from_timestamp(reading.timestamp, 0).map(|dt| dt.to_rfc3339());

    if let Some(hr) = reading.heart_rate {
        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}-hr", reading.reading_id),
            "resource": {
                "resourceType": "Observation",
                "id": format!("{}-hr", reading.reading_id),
                "status": "final",
                "category": [{
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "vital-signs"
                    }]
                }],
                "code": {
                    "coding": [{
                        "system": "http://loinc.org",
                        "code": "8867-4",
                        "display": "Heart rate"
                    }]
                },
                "subject": {"reference": format!("Patient/{}", patient_id)},
                "effectiveDateTime": effective_time,
                "valueQuantity": {
                    "value": hr,
                    "unit": "beats/minute",
                    "system": "http://unitsofmeasure.org",
                    "code": "/min"
                }
            }
        }));
    }

    if let (Some(sys), Some(dia)) = (reading.systolic_bp, reading.diastolic_bp) {
        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}-bp", reading.reading_id),
            "resource": {
                "resourceType": "Observation",
                "id": format!("{}-bp", reading.reading_id),
                "status": "final",
                "category": [{
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "vital-signs"
                    }]
                }],
                "code": {
                    "coding": [{
                        "system": "http://loinc.org",
                        "code": "85354-9",
                        "display": "Blood pressure panel"
                    }]
                },
                "subject": {"reference": format!("Patient/{}", patient_id)},
                "effectiveDateTime": effective_time,
                "component": [{
                    "code": {
                        "coding": [{
                            "system": "http://loinc.org",
                            "code": "8480-6",
                            "display": "Systolic blood pressure"
                        }]
                    },
                    "valueQuantity": {
                        "value": sys,
                        "unit": "mmHg",
                        "system": "http://unitsofmeasure.org",
                        "code": "mm[Hg]"
                    }
                }, {
                    "code": {
                        "coding": [{
                            "system": "http://loinc.org",
                            "code": "8462-4",
                            "display": "Diastolic blood pressure"
                        }]
                    },
                    "valueQuantity": {
                        "value": dia,
                        "unit": "mmHg",
                        "system": "http://unitsofmeasure.org",
                        "code": "mm[Hg]"
                    }
                }]
            }
        }));
    }

    if let Some(spo2) = reading.oxygen_saturation {
        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}-spo2", reading.reading_id),
            "resource": {
                "resourceType": "Observation",
                "id": format!("{}-spo2", reading.reading_id),
                "status": "final",
                "category": [{
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "vital-signs"
                    }]
                }],
                "code": {
                    "coding": [{
                        "system": "http://loinc.org",
                        "code": "2708-6",
                        "display": "Oxygen saturation"
                    }]
                },
                "subject": {"reference": format!("Patient/{}", patient_id)},
                "effectiveDateTime": effective_time,
                "valueQuantity": {
                    "value": spo2,
                    "unit": "%",
                    "system": "http://unitsofmeasure.org",
                    "code": "%"
                }
            }
        }));
    }

    entries
}

/// FHIR Observation resource - Get patient vital signs
#[get("/api/fhir/r4/Observation")]
pub async fn fhir_get_observations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "login"}]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "unknown"}]
            }));
        }
    };

    let patient_id = match query.get("patient") {
        Some(id) => id.clone(),
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "required",
                    "diagnostics": "patient parameter is required"
                }]
            }));
        }
    };

    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    // (page, per_page) — not (per_page, page). Passing 0 as `per_page` made
    // `limit()` zero, so this FHIR bundle always came back empty.
    let pg = crate::repositories::traits::Pagination::new(0, 500);
    let readings: Vec<crate::clinical::VitalSignsReading> = match data
        .repositories
        .vital_signs
        .get_by_patient(&patient_id, pg)
        .await
    {
        Ok(result) => result.items.into_iter().map(Into::into).collect(),
        Err(e) => {
            log::error!("FHIR vital signs lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "exception"}]
            }));
        }
    };

    let entries: Vec<serde_json::Value> = readings
        .iter()
        .flat_map(|reading| vital_signs_observation_entries(reading, &patient_id))
        .collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR Encounter resource - Get patient encounters/visits
#[get("/api/fhir/r4/Encounter")]
pub async fn fhir_get_encounters(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "Missing X-User-Id header"
                }]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "User not found"
                }]
            }));
        }
    };

    let patient_id = query.get("patient").cloned().unwrap_or_default();
    if patient_id.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "required",
                "diagnostics": "patient parameter is required"
            }]
        }));
    }

    // RBAC: Non-healthcare providers can only see their own encounters
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied to other patient's encounters"
            }]
        }));
    }

    // Get triage assessments as encounters via repository
    // (page, per_page) — not (per_page, page). Passing 0 as `per_page` made
    // `limit()` zero, so this FHIR bundle always came back empty.
    let pg = crate::repositories::traits::Pagination::new(0, 500);
    let patient_triages = match data
        .repositories
        .triage_assessments
        .get_by_patient(&patient_id, pg)
        .await
    {
        Ok(r) => r.items,
        Err(e) => {
            log::error!("FHIR triage lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "exception"}]
            }));
        }
    };

    let entries: Vec<serde_json::Value> = patient_triages
        .iter()
        .map(|triage| triage_encounter_entry(triage, &patient_id))
        .collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// Builds one FHIR `Encounter` bundle entry from a triage assessment,
/// mapping the ESI (Emergency Severity Index) level to HL7's ActPriority code.
fn triage_encounter_entry(
    triage: &crate::repositories::traits::TriageAssessmentEntity,
    patient_id: &str,
) -> serde_json::Value {
    let esi = crate::clinical::ESILevel::from_level(triage.esi_level as u8)
        .unwrap_or(crate::clinical::ESILevel::Level3Urgent);
    let priority_code = match esi {
        crate::clinical::ESILevel::Level1Resuscitation
        | crate::clinical::ESILevel::Level2Emergent => "EM",
        crate::clinical::ESILevel::Level3Urgent => "UR",
        _ => "R",
    };
    let priority_display = match esi {
        crate::clinical::ESILevel::Level1Resuscitation => "ESI Level 1 - Resuscitation",
        crate::clinical::ESILevel::Level2Emergent => "ESI Level 2 - Emergent",
        crate::clinical::ESILevel::Level3Urgent => "ESI Level 3 - Urgent",
        crate::clinical::ESILevel::Level4LessUrgent => "ESI Level 4 - Less Urgent",
        crate::clinical::ESILevel::Level5NonUrgent => "ESI Level 5 - Non-Urgent",
    };

    serde_json::json!({
        "fullUrl": format!("urn:uuid:{}", triage.id),
        "resource": {
            "resourceType": "Encounter",
            "id": triage.id,
            "status": "finished",
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": "EMER",
                "display": "Emergency"
            },
            "type": [{
                "coding": [{
                    "system": "http://snomed.info/sct",
                    "code": "50849002",
                    "display": "Emergency department patient visit"
                }]
            }],
            "subject": {"reference": format!("Patient/{}", patient_id)},
            "period": {
                "start": triage.triage_time.to_rfc3339()
            },
            "priority": {
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/v3-ActPriority",
                    "code": priority_code,
                    "display": priority_display
                }]
            },
            "reasonCode": [{
                "text": &triage.chief_complaint
            }]
        }
    })
}

/// FHIR DiagnosticReport resource - Get patient diagnostic reports
#[get("/api/fhir/r4/DiagnosticReport")]
pub async fn fhir_get_diagnostic_reports(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "Missing X-User-Id header"
                }]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "User not found"
                }]
            }));
        }
    };

    let patient_id = query.get("patient").cloned().unwrap_or_default();
    if patient_id.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "required",
                "diagnostics": "patient parameter is required"
            }]
        }));
    }

    // RBAC check - non-healthcare providers can only see their own reports
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied to other patient's reports"
            }]
        }));
    }

    // Get radiology reports as diagnostic reports
    let radiology_entities = data
        .repositories
        .radiology_reports
        .get_by_patient(&patient_id, Pagination::new(0, 1000))
        .await
        .map(|p| p.items)
        .unwrap_or_default();

    let entries: Vec<serde_json::Value> = radiology_entities
        .iter()
        .filter_map(|entity| radiology_diagnostic_report_entry(entity, &patient_id))
        .collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// Builds one FHIR `DiagnosticReport` bundle entry from a stored radiology
/// report. Returns `None` when the entity's JSON blob doesn't deserialize
/// into a `RadiologyReport` (defensive — shouldn't happen for real rows).
fn radiology_diagnostic_report_entry(
    entity: &crate::repositories::traits::RadiologyReportEntity,
    patient_id: &str,
) -> Option<serde_json::Value> {
    let report: crate::clinical::RadiologyReport =
        serde_json::from_value(entity.data.clone()).ok()?;
    let id = &entity.id;
    let status_str = match &report.status {
        RadiologyReportStatus::Final => "final",
        RadiologyReportStatus::Preliminary => "preliminary",
        RadiologyReportStatus::Addendum => "amended",
        RadiologyReportStatus::Corrected => "corrected",
    };
    let has_critical = report.critical_finding;
    let study_type_str = format!("{:?}", report.study_type);

    let effective_dt =
        chrono::DateTime::from_timestamp(report.study_datetime, 0).map(|dt| dt.to_rfc3339());
    let issued_dt = report
        .final_time
        .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
        .map(|dt| dt.to_rfc3339());

    let mut resource = serde_json::json!({
        "resourceType": "DiagnosticReport",
        "id": id,
        "status": status_str,
        "category": [{
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                "code": "RAD",
                "display": "Radiology"
            }]
        }],
        "code": {
            "coding": [{
                "system": "http://loinc.org",
                "display": &study_type_str
            }],
            "text": &study_type_str
        },
        "subject": {"reference": format!("Patient/{}", patient_id)},
        "effectiveDateTime": effective_dt,
        "issued": issued_dt,
        "performer": [{
            "reference": format!("Practitioner/{}", report.radiologist)
        }],
        "conclusion": &report.impression
    });

    if has_critical {
        resource["conclusionCode"] = serde_json::json!([{
            "coding": [{
                "system": "http://snomed.info/sct",
                "code": "281647001",
                "display": "Critical finding"
            }]
        }]);
    }

    Some(serde_json::json!({
        "fullUrl": format!("urn:uuid:{}", id),
        "resource": resource
    }))
}
