//! FHIR R4 transaction ingestion for the MediChain Patient profile.
//!
//! The public FHIR surface must not accept a Bundle and then quietly ignore
//! entries it cannot persist. This module therefore validates a transaction
//! before writing anything and advertises only the resource operation that is
//! implemented end-to-end here.

use super::*;
use serde::Deserialize;
use serde_json::Value;

const NATIONAL_ID_SYSTEM: &str = "urn:medichain:national-id";
const BLOOD_TYPE_EXTENSION: &str =
    "https://medichain.health/fhir/StructureDefinition/emergency-blood-type";
const ORGAN_DONOR_EXTENSION: &str = "https://medichain.health/fhir/StructureDefinition/organ-donor";
const DNR_EXTENSION: &str = "https://medichain.health/fhir/StructureDefinition/dnr-status";

/// The subset of the FHIR Bundle envelope needed for a transaction request.
#[derive(Debug, Deserialize)]
pub struct FhirTransactionBundle {
    #[serde(rename = "resourceType")]
    resource_type: String,
    #[serde(rename = "type")]
    bundle_type: String,
    entry: Vec<FhirTransactionEntry>,
}

/// One transaction entry. The resource stays as JSON because FHIR resources
/// are extensible; `patient_registration_from_resource` validates the exact
/// MediChain Patient profile before it reaches a domain request type.
#[derive(Debug, Deserialize)]
struct FhirTransactionEntry {
    resource: Value,
    request: FhirTransactionRequest,
}

/// The mandatory FHIR request component for a transaction entry.
#[derive(Debug, Deserialize)]
struct FhirTransactionRequest {
    method: String,
    url: String,
}

/// Build a FHIR OperationOutcome without disclosing implementation details.
fn fhir_outcome(
    status: actix_web::http::StatusCode,
    code: &str,
    diagnostics: &str,
) -> HttpResponse {
    HttpResponse::build(status)
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": code, "diagnostics": diagnostics}]
        }))
}

/// Extract a non-empty primitive string from a FHIR object.
fn required_string(object: &Value, field: &str) -> Result<String, String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Patient.{field} is required"))
}

/// Resolve the displayable Patient name without guessing a value.
fn patient_name(resource: &Value) -> Result<String, String> {
    let names = resource
        .get("name")
        .and_then(Value::as_array)
        .ok_or_else(|| "Patient.name is required".to_string())?;
    let name = names
        .iter()
        .find_map(|item| {
            item.get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    let given = item
                        .get("given")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .collect::<Vec<_>>();
                    let family = item.get("family").and_then(Value::as_str).map(str::trim);
                    let parts = given
                        .into_iter()
                        .chain(family.filter(|value| !value.is_empty()))
                        .collect::<Vec<_>>();
                    (!parts.is_empty()).then(|| parts.join(" "))
                })
        })
        .ok_or_else(|| "Patient.name needs text, given, or family".to_string())?;
    Ok(name)
}

/// Read an explicitly declared extension value. Absence stays absent; this
/// function never invents a clinical assertion from a general FHIR field.
fn extension_value<'a>(resource: &'a Value, url: &str) -> Option<&'a Value> {
    resource
        .get("extension")
        .and_then(Value::as_array)
        .and_then(|extensions| {
            extensions
                .iter()
                .find(|extension| extension.get("url").and_then(Value::as_str) == Some(url))
        })
}

/// Convert the declared MediChain FHIR Patient profile into the existing
/// request type. The normal registration path remains the single source of
/// truth for the domain entity, encrypted storage and NFC credential.
fn patient_registration_from_resource(resource: &Value) -> Result<RegisterPatientRequest, String> {
    if resource.get("resourceType").and_then(Value::as_str) != Some("Patient") {
        return Err("Transaction resource must be Patient".to_string());
    }
    let national_id = resource
        .get("identifier")
        .and_then(Value::as_array)
        .and_then(|identifiers| {
            identifiers.iter().find_map(|identifier| {
                (identifier.get("system").and_then(Value::as_str) == Some(NATIONAL_ID_SYSTEM))
                    .then(|| identifier.get("value").and_then(Value::as_str))
                    .flatten()
            })
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            format!("Patient.identifier with system {NATIONAL_ID_SYSTEM} is required")
        })?;
    let blood_type = extension_value(resource, BLOOD_TYPE_EXTENSION)
        .and_then(|extension| extension.get("valueCode"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Unknown")
        .to_string();
    let contact = resource
        .get("contact")
        .and_then(Value::as_array)
        .and_then(|contacts| contacts.first())
        .ok_or_else(|| "Patient.contact with an emergency contact is required".to_string())?;
    let contact_name = contact
        .get("name")
        .and_then(|name| name.get("text"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Patient.contact[0].name.text is required".to_string())?;
    let contact_phone = contact
        .get("telecom")
        .and_then(Value::as_array)
        .and_then(|telecom| {
            telecom.iter().find_map(|item| {
                (item.get("system").and_then(Value::as_str) == Some("phone"))
                    .then(|| item.get("value").and_then(Value::as_str))
                    .flatten()
            })
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Patient.contact[0] requires a phone telecom".to_string())?;
    let relationship = contact
        .get("relationship")
        .and_then(Value::as_array)
        .and_then(|relationships| relationships.first())
        .and_then(|relationship| {
            relationship.get("text").or_else(|| {
                relationship
                    .get("coding")?
                    .as_array()?
                    .first()?
                    .get("display")
            })
        })
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Patient.contact[0].relationship is required".to_string())?;
    let phone = resource
        .get("telecom")
        .and_then(Value::as_array)
        .and_then(|telecom| {
            telecom.iter().find_map(|item| {
                (item.get("system").and_then(Value::as_str) == Some("phone"))
                    .then(|| item.get("value").and_then(Value::as_str))
                    .flatten()
            })
        })
        .unwrap_or_default()
        .to_string();

    Ok(RegisterPatientRequest {
        full_name: patient_name(resource)?,
        wallet_address: None,
        date_of_birth: required_string(resource, "birthDate")?,
        time_of_birth: None,
        national_id,
        gender: resource
            .get("gender")
            .and_then(Value::as_str)
            .map(str::to_string),
        phone,
        blood_type,
        allergies: Vec::new(),
        current_medications: Vec::new(),
        chronic_conditions: Vec::new(),
        emergency_contact_name: contact_name,
        emergency_contact_phone: contact_phone,
        emergency_contact_relationship: relationship,
        organ_donor: extension_value(resource, ORGAN_DONOR_EXTENSION)
            .and_then(|extension| extension.get("valueBoolean"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        dnr_status: extension_value(resource, DNR_EXTENSION)
            .and_then(|extension| extension.get("valueBoolean"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        languages: Vec::new(),
    })
}

/// Ingest a FHIR R4 transaction containing exactly one supported Patient create.
///
/// The endpoint is deliberately narrower than generic FHIR transactions until
/// every resource it advertises can share a durable transaction boundary. It
/// rejects an unsupported multi-entry Bundle before any write, avoiding the
/// partial-import failure that makes health-data exchange unsafe.
#[post("/api/fhir/r4/Bundle")]
pub async fn fhir_ingest_transaction(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    bundle: web::Json<FhirTransactionBundle>,
) -> impl Responder {
    let actor = match get_current_user_id(&http_req) {
        Some(actor) => actor,
        None => {
            return fhir_outcome(
                actix_web::http::StatusCode::UNAUTHORIZED,
                "security",
                "Authentication is required",
            )
        }
    };
    let Some(user) = get_user(&data, &actor) else {
        return fhir_outcome(
            actix_web::http::StatusCode::UNAUTHORIZED,
            "security",
            "Authenticated user was not found",
        );
    };
    if !user.role.is_healthcare_provider() {
        return fhir_outcome(
            actix_web::http::StatusCode::FORBIDDEN,
            "forbidden",
            "Only healthcare providers can ingest patient data",
        );
    }
    if bundle.resource_type != "Bundle" || bundle.bundle_type != "transaction" {
        return fhir_outcome(
            actix_web::http::StatusCode::BAD_REQUEST,
            "invalid",
            "FHIR Bundle.type must be transaction",
        );
    }
    if bundle.entry.len() != 1 {
        return fhir_outcome(
            actix_web::http::StatusCode::NOT_IMPLEMENTED,
            "not-supported",
            "This endpoint currently supports exactly one Patient POST transaction entry",
        );
    }
    let entry = &bundle.entry[0];
    if !entry.request.method.eq_ignore_ascii_case("POST") || entry.request.url != "Patient" {
        return fhir_outcome(
            actix_web::http::StatusCode::NOT_IMPLEMENTED,
            "not-supported",
            "Only POST Patient transaction entries are supported",
        );
    }
    let registration = match patient_registration_from_resource(&entry.resource) {
        Ok(registration) => registration,
        Err(error) => {
            return fhir_outcome(actix_web::http::StatusCode::BAD_REQUEST, "invalid", &error)
        }
    };
    let blood_type = match crate::support::parse_blood_type(&registration.blood_type) {
        Ok(blood_type) => blood_type,
        Err(error) => {
            return fhir_outcome(actix_web::http::StatusCode::BAD_REQUEST, "value", &error)
        }
    };
    let patient_id = format!("PAT-{}", uuid::Uuid::new_v4().simple());
    let nfc_tag_id = format!("NFC-{}", uuid::Uuid::new_v4().simple());
    let (profile, nfc_tag) =
        crate::handlers::build_new_patient(&registration, blood_type, &patient_id, &nfc_tag_id);
    let entity = crate::patient_profile_to_entity(&profile, &data.encryption_keyring);
    if let Err(error) = data
        .repositories
        .create_patient_with_nfc(entity, nfc_tag.into())
        .await
    {
        log::error!("FHIR Patient transaction persistence failed: {error}");
        return HttpResponse::InternalServerError()
            .content_type("application/fhir+json")
            .json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "exception", "diagnostics": "Patient transaction could not be persisted"}]
            }));
    }
    HttpResponse::Created()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "transaction-response",
            "entry": [{
                "response": {
                    "status": "201 Created",
                    "location": format!("Patient/{patient_id}")
                }
            }]
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patient_resource() -> Value {
        serde_json::json!({
            "resourceType": "Patient",
            "identifier": [{"system": NATIONAL_ID_SYSTEM, "value": "NIN-123"}],
            "name": [{"given": ["Ama"], "family": "Mensah"}],
            "birthDate": "1990-01-20",
            "telecom": [{"system": "phone", "value": "+27115550123"}],
            "contact": [{
                "relationship": [{"text": "Sibling"}],
                "name": {"text": "Kojo Mensah"},
                "telecom": [{"system": "phone", "value": "+27115550124"}]
            }],
            "extension": [{"url": BLOOD_TYPE_EXTENSION, "valueCode": "O+"}]
        })
    }

    #[test]
    fn fhir_patient_maps_only_declared_values_to_registration() {
        let request = patient_registration_from_resource(&patient_resource()).unwrap();
        assert_eq!(request.full_name, "Ama Mensah");
        assert_eq!(request.national_id, "NIN-123");
        assert_eq!(request.blood_type, "O+");
        assert!(!request.organ_donor);
        assert!(!request.dnr_status);
    }

    #[test]
    fn fhir_patient_without_blood_type_is_unknown() {
        let mut resource = patient_resource();
        resource.as_object_mut().unwrap().remove("extension");
        let request = patient_registration_from_resource(&resource).unwrap();
        assert_eq!(request.blood_type, "Unknown");
    }
}
