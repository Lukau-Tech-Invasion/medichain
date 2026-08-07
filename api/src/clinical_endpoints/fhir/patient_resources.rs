//! `clinical_endpoints::fhir::patient_resources` — HL7 FHIR R4 Patient/AllergyIntolerance/
//! MedicationStatement/Condition resource endpoints.
//!
//! Split out of the former single-file `fhir.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `fhir/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

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
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
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

    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    // Get allergies from repository
    let allergies = data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
        .unwrap_or_default();

    let entries: Vec<serde_json::Value> = allergies
        .iter()
        .enumerate()
        .map(|(i, allergy)| allergy_intolerance_entry(allergy, &patient_id, i))
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

/// Builds one FHIR `AllergyIntolerance` bundle entry. `index` disambiguates
/// the synthetic id/fullUrl since allergy records don't carry their own.
fn allergy_intolerance_entry(
    allergy: &crate::repositories::traits::AllergyEntity,
    patient_id: &str,
    index: usize,
) -> serde_json::Value {
    serde_json::json!({
        "fullUrl": format!("urn:uuid:allergy-{}-{}", patient_id, index),
        "resource": {
            "resourceType": "AllergyIntolerance",
            "id": format!("allergy-{}-{}", patient_id, index),
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

    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
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

    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
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
