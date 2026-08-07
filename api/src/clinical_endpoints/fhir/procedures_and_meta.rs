//! `clinical_endpoints::fhir::procedures_and_meta` — HL7 FHIR R4 Procedure/Immunization
//! resource endpoints + the server CapabilityStatement.
//!
//! Split out of the former single-file `fhir.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `fhir/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

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
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id) {
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
    entries.extend(op_note_procedure_entries(&data, &patient_id).await);
    entries.extend(intubation_procedure_entries(&data, &patient_id).await);
    entries.extend(laceration_procedure_entries(&data, &patient_id).await);

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR `Procedure` bundle entries built from a patient's operative notes.
async fn op_note_procedure_entries(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> Vec<serde_json::Value> {
    let op_note_entities = data
        .repositories
        .operative_notes
        .get_by_patient(patient_id, Pagination::new(0, 1000))
        .await
        .map(|p| p.items)
        .unwrap_or_default();

    op_note_entities
        .iter()
        .filter_map(|entity| {
            let note: crate::clinical::OperativeNote =
                serde_json::from_value(entity.data.clone()).ok()?;
            let id = &entity.id;
            let performed_dt =
                chrono::DateTime::from_timestamp(note.time_out_or, 0).map(|dt| dt.to_rfc3339());
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

            if let Some(complications) = &note.complications {
                resource["complication"] = serde_json::json!([{"text": complications}]);
            }

            Some(serde_json::json!({
                "fullUrl": format!("urn:uuid:{}", id),
                "resource": resource
            }))
        })
        .collect()
}

/// FHIR `Procedure` bundle entries built from a patient's intubation records.
async fn intubation_procedure_entries(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> Vec<serde_json::Value> {
    let intub_entities = data
        .repositories
        .intubation_records
        .get_by_patient(patient_id, Pagination::new(0, 1000))
        .await
        .map(|p| p.items)
        .unwrap_or_default();

    intub_entities
        .iter()
        .filter_map(|entity| {
            let intub: crate::clinical::IntubationRecord =
                serde_json::from_value(entity.data.clone()).ok()?;
            let id = &entity.id;
            Some(serde_json::json!({
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
            }))
        })
        .collect()
}

/// FHIR `Procedure` bundle entries built from a patient's laceration repairs.
async fn laceration_procedure_entries(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> Vec<serde_json::Value> {
    let lac_entities = data
        .repositories
        .laceration_repairs
        .get_by_patient(patient_id, Pagination::new(0, 1000))
        .await
        .map(|p| p.items)
        .unwrap_or_default();

    lac_entities
        .iter()
        .filter_map(|entity| {
            let lac: crate::clinical::LacerationRepair =
                serde_json::from_value(entity.data.clone()).ok()?;
            let id = &entity.id;
            Some(serde_json::json!({
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
            }))
        })
        .collect()
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
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id) {
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
        .map(|imm| immunization_entry(imm, &patient_id))
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

/// Builds one FHIR `Immunization` bundle entry from an immunization record.
fn immunization_entry(
    imm: &crate::clinical::ImmunizationRecord,
    patient_id: &str,
) -> serde_json::Value {
    let id = &imm.record_id;
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

    if let Some(notes) = &imm.notes {
        resource["note"] = serde_json::json!([{"text": notes}]);
    }

    if let Some(reaction) = &imm.adverse_reaction {
        resource["reaction"] = serde_json::json!([{
            "detail": {"display": reaction}
        }]);
    }

    serde_json::json!({
        "fullUrl": format!("urn:uuid:{}", id),
        "resource": resource
    })
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
            "publisher": "Lukau Invasion - MediChain",
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
