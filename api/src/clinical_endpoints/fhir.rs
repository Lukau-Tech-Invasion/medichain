//! `clinical_endpoints::fhir` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// HL7 FHIR R4 Compatible Endpoints
// ============================================================================

/// FHIR Patient resource - Get patient in FHIR R4 format
#[get("/api/fhir/r4/Patient/{patient_id}")]
pub async fn fhir_get_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "login",
                    "diagnostics": "Authentication required"
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
                    "code": "unknown",
                    "diagnostics": "User not found"
                }]
            }));
        }
    };

    // Healthcare providers or patient viewing own data
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied"
            }]
        }));
    }

    // Get patient from repository
    match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(patient) => {
            // Convert to FHIR R4 Patient resource
            let fhir_patient = serde_json::json!({
                "resourceType": "Patient",
                "id": patient.id,
                "meta": {
                    "versionId": "1",
                    "lastUpdated": patient.updated_at.to_rfc3339()
                },
                "identifier": [{
                    "system": "urn:medichain:national-id-hash",
                    "value": patient.national_id_hash
                }, {
                    "system": "urn:medichain:patient-id",
                    "value": patient.id
                }],
                "active": true,
                "name": [{
                    "use": "official",
                    "text": "Patient" // Name is encrypted
                }],
                "birthDate": "Redacted", // DOB is encrypted
                "address": [], // TODO: Address repository
                "contact": [], // TODO: Contact repository
                "communication": [{
                    "language": {
                        "coding": [{
                            "system": "urn:ietf:bcp:47",
                            "code": "en"
                        }]
                    }
                }]
            });

            HttpResponse::Ok()
                .content_type("application/fhir+json")
                .json(fhir_patient)
        }
        Err(_) => HttpResponse::NotFound().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "not-found",
                "diagnostics": format!("Patient {} not found", patient_id)
            }]
        })),
    }
}

/// FHIR AllergyIntolerance resource - Get patient allergies
#[get("/api/fhir/r4/AllergyIntolerance")]
pub async fn fhir_get_allergies(
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

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    // Get allergies from repository
    let allergies = match data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
    {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

    let entries: Vec<serde_json::Value> = allergies.iter().enumerate().map(|(i, allergy)| {
        serde_json::json!({
            "fullUrl": format!("urn:uuid:allergy-{}-{}", patient_id, i),
            "resource": {
                "resourceType": "AllergyIntolerance",
                "id": format!("allergy-{}-{}", patient_id, i),
                "clinicalStatus": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
                        "code": "active"
                    }]
                },
                "verificationStatus": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                        "code": if allergy.verified { "confirmed" } else { "unconfirmed" }
                    }]
                },
                "criticality": match allergy.severity.as_str() {
                    "Severe" | "LifeThreatening" => "high",
                    "Moderate" => "high",
                    "Mild" => "low",
                    _ => "unable-to-assess"
                },
                "code": {
                    "text": allergy.allergen
                },
                "patient": {
                    "reference": format!("Patient/{}", patient_id)
                },
                "reaction": allergy.reaction.as_ref().map(|r| vec![serde_json::json!({
                    "description": r
                })])
            }
        })
    }).collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR MedicationStatement resource - Get patient medications
#[get("/api/fhir/r4/MedicationStatement")]
pub async fn fhir_get_medications(
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

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    // TODO: Phase 2: Chronic medications should be fetched from repository
    let medications: Vec<String> = Vec::new();

    let entries: Vec<serde_json::Value> = medications
        .iter()
        .enumerate()
        .map(|(i, med)| {
            serde_json::json!({
                "fullUrl": format!("urn:uuid:med-{}-{}", patient_id, i),
                "resource": {
                    "resourceType": "MedicationStatement",
                    "id": format!("med-{}-{}", patient_id, i),
                    "status": "active",
                    "medicationCodeableConcept": {
                        "text": med
                    },
                    "subject": {
                        "reference": format!("Patient/{}", patient_id)
                    }
                }
            })
        })
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

/// FHIR Condition resource - Get patient conditions
#[get("/api/fhir/r4/Condition")]
pub async fn fhir_get_conditions(
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

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    // TODO: Phase 2: Chronic conditions should be fetched from repository
    let conditions: Vec<String> = Vec::new();

    let entries: Vec<serde_json::Value> = conditions
        .iter()
        .enumerate()
        .map(|(i, cond)| {
            serde_json::json!({
                "fullUrl": format!("urn:uuid:cond-{}-{}", patient_id, i),
                "resource": {
                    "resourceType": "Condition",
                    "id": format!("cond-{}-{}", patient_id, i),
                    "clinicalStatus": {
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                            "code": "active"
                        }]
                    },
                    "code": {
                        "text": cond
                    },
                    "subject": {
                        "reference": format!("Patient/{}", patient_id)
                    }
                }
            })
        })
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

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    let pg = crate::repositories::traits::Pagination::new(500, 0);
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

    if !readings.is_empty() {
        {
            let mut entries: Vec<serde_json::Value> = Vec::new();

            for reading in &readings {
                // Heart Rate
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
                            "effectiveDateTime": chrono::DateTime::from_timestamp(reading.timestamp, 0)
                                .map(|dt| dt.to_rfc3339()),
                            "valueQuantity": {
                                "value": hr,
                                "unit": "beats/minute",
                                "system": "http://unitsofmeasure.org",
                                "code": "/min"
                            }
                        }
                    }));
                }

                // Blood Pressure
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
                            "effectiveDateTime": chrono::DateTime::from_timestamp(reading.timestamp, 0)
                                .map(|dt| dt.to_rfc3339()),
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

                // Oxygen Saturation
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
                            "effectiveDateTime": chrono::DateTime::from_timestamp(reading.timestamp, 0)
                                .map(|dt| dt.to_rfc3339()),
                            "valueQuantity": {
                                "value": spo2,
                                "unit": "%",
                                "system": "http://unitsofmeasure.org",
                                "code": "%"
                            }
                        }
                    }));
                }
            }

            HttpResponse::Ok()
                .content_type("application/fhir+json")
                .json(serde_json::json!({
                    "resourceType": "Bundle",
                    "type": "searchset",
                    "total": entries.len(),
                    "entry": entries
                }))
        }
    } else {
        HttpResponse::Ok()
            .content_type("application/fhir+json")
            .json(serde_json::json!({
                "resourceType": "Bundle",
                "type": "searchset",
                "total": 0,
                "entry": []
            }))
    }
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
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
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
    let pg = crate::repositories::traits::Pagination::new(500, 0);
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
        .map(|triage| {
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
        })
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
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
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
        .filter_map(|entity| {
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

            // Get study type as string
            let study_type_str = format!("{:?}", report.study_type);

            let effective_dt = chrono::DateTime::from_timestamp(report.study_datetime, 0)
                .map(|dt| dt.to_rfc3339());
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
        })
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

/// FHIR Procedure resource - Get patient procedures
#[get("/api/fhir/r4/Procedure")]
pub async fn fhir_get_procedures(
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

    // RBAC check - non-healthcare providers can only see their own data
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied to other patient's procedures"
            }]
        }));
    }

    let mut entries: Vec<serde_json::Value> = Vec::new();

    // Get operative notes as procedures (via repository)
    let op_note_entities = data
        .repositories
        .operative_notes
        .get_by_patient(&patient_id, Pagination::new(0, 1000))
        .await
        .map(|p| p.items)
        .unwrap_or_default();
    for entity in &op_note_entities {
        let note: crate::clinical::OperativeNote = match serde_json::from_value(entity.data.clone())
        {
            Ok(n) => n,
            Err(_) => continue,
        };
        let id = &entity.id;
        let performed_dt =
            chrono::DateTime::from_timestamp(note.time_out_or, 0).map(|dt| dt.to_rfc3339());

        // Get primary surgeon from surgeons list
        let surgeon_ref = note
            .surgeons
            .first()
            .map(|s| format!("Practitioner/{}", s.name))
            .unwrap_or_else(|| "Practitioner/unknown".to_string());

        let mut resource = serde_json::json!({
            "resourceType": "Procedure",
            "id": id,
            "status": "completed",
            "category": {
                "coding": [{
                    "system": "http://snomed.info/sct",
                    "code": "387713003",
                    "display": "Surgical procedure"
                }]
            },
            "code": {
                "text": &note.procedure_performed
            },
            "subject": {"reference": format!("Patient/{}", patient_id)},
            "performedDateTime": performed_dt,
            "performer": [{
                "actor": {"reference": surgeon_ref},
                "function": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "304292004",
                        "display": "Surgeon"
                    }]
                }
            }],
            "outcome": {
                "text": &note.findings
            }
        });

        // Add complication if present
        if let Some(complications) = &note.complications {
            resource["complication"] = serde_json::json!([{"text": complications}]);
        }

        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}", id),
            "resource": resource
        }));
    }

    // Get intubations as procedures (via repository)
    let intub_entities = data
        .repositories
        .intubation_records
        .get_by_patient(&patient_id, Pagination::new(0, 1000))
        .await
        .map(|p| p.items)
        .unwrap_or_default();
    for entity in &intub_entities {
        let intub: crate::clinical::IntubationRecord =
            match serde_json::from_value(entity.data.clone()) {
                Ok(n) => n,
                Err(_) => continue,
            };
        let id = &entity.id;
        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}", id),
            "resource": {
                "resourceType": "Procedure",
                "id": id,
                "status": if intub.successful { "completed" } else { "stopped" },
                "category": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "103693007",
                        "display": "Respiratory procedure"
                    }]
                },
                "code": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "112798008",
                        "display": "Endotracheal intubation"
                    }]
                },
                "subject": {"reference": format!("Patient/{}", patient_id)},
                "performedDateTime": chrono::DateTime::from_timestamp(intub.procedure_time, 0)
                    .map(|dt| dt.to_rfc3339()),
                "performer": [{
                    "actor": {"reference": format!("Practitioner/{}", intub.performed_by)}
                }],
                "outcome": {
                    "text": if intub.successful { "Successful intubation" } else { "Failed - required alternative" }
                }
            }
        }));
    }

    // Get laceration repairs as procedures (via repository)
    let lac_entities = data
        .repositories
        .laceration_repairs
        .get_by_patient(&patient_id, Pagination::new(0, 1000))
        .await
        .map(|p| p.items)
        .unwrap_or_default();
    for entity in &lac_entities {
        let lac: crate::clinical::LacerationRepair =
            match serde_json::from_value(entity.data.clone()) {
                Ok(n) => n,
                Err(_) => continue,
            };
        let id = &entity.id;
        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}", id),
            "resource": {
                "resourceType": "Procedure",
                "id": id,
                "status": "completed",
                "category": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "387687001",
                        "display": "Minor surgical procedure"
                    }]
                },
                "code": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "288086009",
                        "display": "Suture of laceration"
                    }]
                },
                "subject": {"reference": format!("Patient/{}", patient_id)},
                "performedDateTime": chrono::DateTime::from_timestamp(lac.procedure_time, 0)
                    .map(|dt| dt.to_rfc3339()),
                "performer": [{
                    "actor": {"reference": format!("Practitioner/{}", lac.performed_by)}
                }],
                "bodySite": [{
                    "text": &lac.location
                }],
                "note": [{
                    "text": format!("Closure: {:?}", lac.closure)
                }]
            }
        }));
    }

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR Immunization resource - Get patient immunizations
#[get("/api/fhir/r4/Immunization")]
pub async fn fhir_get_immunizations(
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

    // RBAC check - non-healthcare providers can only see their own data
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied to other patient's immunizations"
            }]
        }));
    }

    // Get immunization records via repository
    let patient_immunizations: Vec<crate::clinical::ImmunizationRecord> = match data
        .repositories
        .immunization_records
        .get_by_patient(&patient_id)
        .await
    {
        Ok(items) => items
            .into_iter()
            .map(crate::clinical::ImmunizationRecord::from)
            .collect(),
        Err(_) => Vec::new(),
    };

    let entries: Vec<serde_json::Value> = patient_immunizations
        .iter()
        .map(|imm| {
            let id = &imm.record_id;
            // Get route as string
            let route_str = format!("{:?}", imm.route);

            let mut resource = serde_json::json!({
                "resourceType": "Immunization",
                "id": id,
                "status": "completed",
                "vaccineCode": {
                    "coding": [{
                        "system": "http://hl7.org/fhir/sid/cvx",
                        "code": &imm.cvx_code,
                        "display": &imm.vaccine_name
                    }],
                    "text": &imm.vaccine_name
                },
                "patient": {"reference": format!("Patient/{}", patient_id)},
                "occurrenceDateTime": &imm.administration_date,
                "primarySource": true,
                "lotNumber": &imm.lot_number,
                "expirationDate": &imm.expiration_date,
                "site": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/v3-ActSite",
                        "display": &imm.site
                    }]
                },
                "route": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration",
                        "display": &route_str
                    }]
                },
                "protocolApplied": [{
                    "doseNumberPositiveInt": imm.dose_number
                }],
                "performer": [{
                    "actor": {"reference": format!("Practitioner/{}", imm.administered_by)}
                }],
                "manufacturer": {
                    "display": &imm.manufacturer
                }
            });

            // Add notes if present
            if let Some(notes) = &imm.notes {
                resource["note"] = serde_json::json!([{"text": notes}]);
            }

            // Add adverse reaction if present
            if let Some(reaction) = &imm.adverse_reaction {
                resource["reaction"] = serde_json::json!([{
                    "detail": {"display": reaction}
                }]);
            }

            serde_json::json!({
                "fullUrl": format!("urn:uuid:{}", id),
                "resource": resource
            })
        })
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

/// FHIR Capability Statement - Server metadata
#[get("/api/fhir/r4/metadata")]
pub async fn fhir_capability_statement() -> impl Responder {
    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "CapabilityStatement",
            "status": "active",
            "date": "2026-01-06",
            "publisher": "Trustware - MediChain",
            "kind": "instance",
            "software": {
                "name": "MediChain FHIR Server",
                "version": "1.0.0"
            },
            "implementation": {
                "description": "MediChain HL7 FHIR R4 API"
            },
            "fhirVersion": "4.0.1",
            "format": ["application/fhir+json"],
            "rest": [{
                "mode": "server",
                "resource": [
                    {
                        "type": "Patient",
                        "interaction": [{"code": "read"}, {"code": "search-type"}],
                        "searchParam": [{"name": "_id", "type": "token"}]
                    },
                    {
                        "type": "AllergyIntolerance",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "MedicationStatement",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "Condition",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "Observation",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [
                            {"name": "patient", "type": "reference"},
                            {"name": "category", "type": "token"}
                        ]
                    },
                    {
                        "type": "Encounter",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "DiagnosticReport",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "Procedure",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "Immunization",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    }
                ]
            }]
        }))
}
