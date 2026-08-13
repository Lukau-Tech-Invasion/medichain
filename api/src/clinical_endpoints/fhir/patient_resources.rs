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

/// Whether `value` is already a valid FHIR `date` (`YYYY`, `YYYY-MM` or
/// `YYYY-MM-DD`), returning it if so.
///
/// FHIR requires that shape. The Patient resource previously emitted the
/// literal string `"Redacted"` in `birthDate`, which conformant clients reject
/// outright — so a value that does not parse is omitted rather than sent.
fn fhir_date(value: &str) -> Option<&str> {
    let ok = match value.len() {
        4 => value.chars().all(|c| c.is_ascii_digit()),
        7 => chrono::NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d").is_ok(),
        10 => chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok(),
        _ => false,
    };
    ok.then_some(value)
}

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
            // The demographics live in the patient's encrypted profile blob.
            // This resource used to emit the literal name "Patient", the
            // literal birthDate "Redacted", empty `address`/`contact` arrays
            // and a hardcoded "en" language — without ever attempting to
            // decrypt. Two of those were actively wrong rather than merely
            // incomplete: "Redacted" is not a valid FHIR `date`, so conformant
            // clients reject the resource, and an empty `contact` array is a
            // positive assertion that the patient has NO next of kin, which an
            // importing system will happily believe.
            //
            // FHIR's own convention is that an element it cannot state is
            // ABSENT, not empty or invented. So each element below is emitted
            // only when the profile actually supplies it.
            let profile = crate::patient_entity_to_profile(&patient, &data.encryption_keyring);

            let mut fhir_patient = serde_json::json!({
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
                "active": patient.is_active
            });
            let object = fhir_patient
                .as_object_mut()
                .expect("constructed as a JSON object above");

            if let Some(profile) = profile.as_ref() {
                object.insert(
                    "name".to_string(),
                    serde_json::json!([{ "use": "official", "text": profile.full_name }]),
                );
                // FHIR `date`: YYYY, YYYY-MM or YYYY-MM-DD. Emitted only when
                // the stored value is already in that form — a malformed date
                // is worse than an absent one.
                if fhir_date(&profile.date_of_birth).is_some() {
                    object.insert(
                        "birthDate".to_string(),
                        serde_json::json!(profile.date_of_birth),
                    );
                }
                if !profile.phone.is_empty() {
                    object.insert(
                        "telecom".to_string(),
                        serde_json::json!([{
                            "system": "phone",
                            "value": profile.phone,
                            "use": "mobile"
                        }]),
                    );
                }
                if let Some(address) = profile.address.as_ref() {
                    object.insert("address".to_string(), serde_json::json!([{
                        "use": "home",
                        "line": address.street.as_ref().map(|s| vec![s.clone()]).unwrap_or_default(),
                        "city": address.city,
                        "state": address.state,
                        "postalCode": address.postal_code,
                        "country": address.country
                    }]));
                }
                let contacts: Vec<serde_json::Value> = profile
                    .emergency_info
                    .emergency_contacts
                    .iter()
                    .map(|contact| {
                        serde_json::json!({
                            "relationship": [{
                                "coding": [{
                                    "system":
                                        "http://terminology.hl7.org/CodeSystem/v2-0131",
                                    "code": "C",
                                    "display": "Emergency Contact"
                                }],
                                "text": contact.relationship
                            }],
                            "name": { "text": contact.name },
                            "telecom": [{ "system": "phone", "value": contact.phone }]
                        })
                    })
                    .collect();
                if !contacts.is_empty() {
                    object.insert("contact".to_string(), serde_json::json!(contacts));
                }
                if let Some(language) = profile.preferences.display_language.as_ref() {
                    object.insert(
                        "communication".to_string(),
                        serde_json::json!([{
                            "language": {
                                "coding": [{
                                    "system": "urn:ietf:bcp:47",
                                    "code": language
                                }]
                            },
                            "preferred": true
                        }]),
                    );
                }
            } else {
                // Undecryptable profile: say so in-band rather than emitting a
                // resource that looks complete and says the patient has no
                // name, address or next of kin.
                log::error!("FHIR Patient {patient_id}: profile could not be decrypted");
                object.insert(
                    "_name".to_string(),
                    serde_json::json!({
                        "extension": [{
                            "url": "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
                            "valueCode": "masked"
                        }]
                    }),
                );
            }

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

    // These come from the patient's encrypted profile — the same
    // `emergency_info` the first-responder card reads, so the two surfaces
    // cannot disagree about what the patient is taking.
    //
    // This was `Vec::new()`, so the Bundle always reported `total: 0`. For an
    // interoperability endpoint that is not an empty result, it is a positive
    // statement to the importing system that the patient takes no medication —
    // which is exactly the assertion that gets someone prescribed something
    // that interacts. An unreadable profile now fails the request instead.
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(patient) => patient,
        Err(_) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "not-found",
                    "diagnostics": format!("Patient {} not found", patient_id)
                }]
            }));
        }
    };
    let medications: Vec<String> =
        match crate::patient_entity_to_profile(&patient, &data.encryption_keyring) {
            Some(profile) => profile.emergency_info.current_medications,
            None => {
                log::error!(
                    "FHIR MedicationStatement {patient_id}: profile could not be decrypted"
                );
                return HttpResponse::ServiceUnavailable().json(serde_json::json!({
                    "resourceType": "OperationOutcome",
                    "issue": [{
                        "severity": "error",
                        "code": "exception",
                        "diagnostics": "Medication history is unavailable; it must not be \
                                        reported as empty."
                    }]
                }));
            }
        };

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

    // Same source and same reasoning as the MedicationStatement bundle above:
    // an empty `Condition` bundle asserts the patient has no chronic
    // conditions, so it must reflect the record rather than a placeholder.
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(patient) => patient,
        Err(_) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "not-found",
                    "diagnostics": format!("Patient {} not found", patient_id)
                }]
            }));
        }
    };
    let conditions: Vec<String> =
        match crate::patient_entity_to_profile(&patient, &data.encryption_keyring) {
            Some(profile) => profile.emergency_info.chronic_conditions,
            None => {
                log::error!("FHIR Condition {patient_id}: profile could not be decrypted");
                return HttpResponse::ServiceUnavailable().json(serde_json::json!({
                    "resourceType": "OperationOutcome",
                    "issue": [{
                        "severity": "error",
                        "code": "exception",
                        "diagnostics": "Condition history is unavailable; it must not be \
                                        reported as empty."
                    }]
                }));
            }
        };

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
