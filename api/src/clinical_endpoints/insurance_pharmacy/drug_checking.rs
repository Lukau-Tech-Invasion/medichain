//! `clinical_endpoints::insurance_pharmacy::drug_checking` — Phase 21 drug-interaction
//! checking logic (consumes the reference data in `drug_database.rs`).
//!
//! Split out of the former single-file `insurance_pharmacy.rs` (itself split from the
//! original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `insurance_pharmacy/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Check drug interactions request
#[derive(Debug, Deserialize)]
pub struct CheckDrugInteractionsRequest {
    /// The patient the medicines are for, when there is one. A check with no
    /// patient is a reference lookup: drug-drug only, and filed to no chart.
    /// The page used to send `"UNKNOWN"` here, and every such check was
    /// stored as a history record belonging to a patient of that name.
    #[serde(default)]
    pub patient_id: Option<String>,
    pub medications: Vec<String>,
    pub include_allergies: Option<bool>,
    /// Asked for by the caller and **not currently honoured**.
    ///
    /// `DrugInteractionsPage` sends this whenever the patient has recorded
    /// conditions, so the clinician believes conditions were considered. No
    /// drug-condition screening exists: there is no curated dataset for it, and
    /// inventing one would be fabricating clinical content -- worse than not
    /// having it.
    ///
    /// Kept in the request rather than dropped so the response can say plainly
    /// that it was not screened. See `screened` in the response: a check that
    /// silently does less than it was asked lets "No significant interactions
    /// detected" be read as "safe in this patient's conditions".
    ///
    /// Never read on purpose -- reading it would imply acting on it. Dropping
    /// the field instead would make an existing caller's body fail to
    /// deserialise, and would remove the record of what was asked for.
    #[allow(dead_code)]
    pub include_conditions: Option<bool>,
}

/// Check for drug-drug and drug-allergy interactions
#[post("/api/interactions/check")]
pub async fn check_drug_interactions(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CheckDrugInteractionsRequest>,
) -> impl Responder {
    let current_user_id = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    // Only healthcare providers can check interactions
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can check drug interactions".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Auto-screen the requested medications against the curated interaction table.
    let interactions = evaluate_drug_interactions(&req.medications);
    check_interactions_response(&data, &req, &current_user_id, interactions).await
}

/// A single drug-pair interaction row as loaded from a data file (see `evaluate_drug_interactions`).
#[derive(Debug, Deserialize)]
struct ImportedInteraction {
    drug_a: String,
    drug_b: String,
    severity: String,
    description: String,
}

/// Top-level shape of `api/data/drug_interactions_builtin.json` and of any external
/// overlay file pointed to by `DRUG_INTERACTIONS_DATA_PATH` (see `api/data/README.md`).
#[derive(Debug, Deserialize)]
struct InteractionDataFile {
    interactions: Vec<ImportedInteraction>,
}

/// Built-in curated interaction dataset, compiled into the binary so the checker
/// always has a baseline even with no external data configured.
const BUILTIN_INTERACTIONS_JSON: &str =
    include_str!("../../../data/drug_interactions_builtin.json");

/// The merged interaction table: the compiled-in baseline plus, if configured, an
/// external overlay file (e.g. converted from a licensed RxNorm/DrugBank export).
/// Loaded once and cached — the underlying files never change at runtime.
/// Parse one interaction data file's contents into flat tuples. Pulled out of
/// `interaction_table()` so it can be unit-tested directly (built-in JSON validity,
/// overlay-file format) without touching the process-wide cache below.
fn parse_interactions(
    json: &str,
) -> Result<Vec<(String, String, String, String)>, serde_json::Error> {
    let file: InteractionDataFile = serde_json::from_str(json)?;
    Ok(file
        .interactions
        .into_iter()
        .map(|i| (i.drug_a, i.drug_b, i.severity, i.description))
        .collect())
}

static INTERACTION_TABLE: std::sync::OnceLock<Vec<(String, String, String, String)>> =
    std::sync::OnceLock::new();

fn interaction_table() -> &'static [(String, String, String, String)] {
    INTERACTION_TABLE.get_or_init(|| {
        let mut table = parse_interactions(BUILTIN_INTERACTIONS_JSON)
            .expect("api/data/drug_interactions_builtin.json must be valid JSON matching InteractionDataFile");

        // Optional external overlay — e.g. a converted RxNorm/DrugBank licensed export.
        // Additive only: never replaces the built-in baseline. See api/data/README.md
        // for the expected schema and how to obtain/convert a real licensed dataset.
        if let Ok(path) = std::env::var("DRUG_INTERACTIONS_DATA_PATH") {
            match std::fs::read_to_string(&path) {
                Ok(contents) => match parse_interactions(&contents) {
                    Ok(overlay) => {
                        log::info!(
                            "Loaded {} additional drug interactions from DRUG_INTERACTIONS_DATA_PATH={}",
                            overlay.len(),
                            path
                        );
                        table.extend(overlay);
                    }
                    Err(e) => log::warn!(
                        "DRUG_INTERACTIONS_DATA_PATH={} did not parse as valid interaction data ({}); ignoring overlay",
                        path,
                        e
                    ),
                },
                Err(e) => log::warn!(
                    "DRUG_INTERACTIONS_DATA_PATH={} could not be read ({}); ignoring overlay",
                    path,
                    e
                ),
            }
        }

        table
    })
}

/// Drug-drug interaction table and pairwise screen — the single source of truth
/// shared by the `/api/interactions/check` endpoint and `create_e_prescription`.
/// The table itself lives in `api/data/drug_interactions_builtin.json` (plus an
/// optional `DRUG_INTERACTIONS_DATA_PATH` overlay) rather than inline in code, so it
/// can be regenerated or extended without a rebuild. Each medication pair is matched
/// (case-insensitive substring) against the table.
pub fn evaluate_drug_interactions(medications: &[String]) -> Vec<crate::clinical::DrugInteraction> {
    let known_interactions = interaction_table();

    let mut interactions: Vec<crate::clinical::DrugInteraction> = Vec::new();
    let medications_lower: Vec<String> = medications.iter().map(|m| m.to_lowercase()).collect();

    // Check each pair of medications
    for i in 0..medications_lower.len() {
        for j in (i + 1)..medications_lower.len() {
            let med1 = &medications_lower[i];
            let med2 = &medications_lower[j];

            for (drug1, drug2, severity, description) in known_interactions {
                if (med1.contains(drug1.as_str()) && med2.contains(drug2.as_str()))
                    || (med1.contains(drug2.as_str()) && med2.contains(drug1.as_str()))
                {
                    let severity_enum = match severity.as_str() {
                        "contraindicated" => crate::clinical::InteractionSeverity::Contraindicated,
                        "major" => crate::clinical::InteractionSeverity::Major,
                        "moderate" => crate::clinical::InteractionSeverity::Moderate,
                        _ => crate::clinical::InteractionSeverity::Minor,
                    };

                    interactions.push(crate::clinical::DrugInteraction {
                        drug_a: medications[i].clone(),
                        drug_b: medications[j].clone(),
                        severity: severity_enum,
                        description: description.clone(),
                        clinical_effects: description.clone(),
                        management: format!(
                            "Monitor closely or consider alternatives for {} and {}",
                            medications[i], medications[j]
                        ),
                        evidence_level: crate::clinical::EvidenceLevel::Established,
                        source: "Clinical Pharmacology Database".to_string(),
                    });
                }
            }
        }
    }
    interactions
}

/// Finalize a standalone drug-interaction check: allergy screen, result assembly,
/// persistence, and JSON response. Split out of `check_drug_interactions` so the
/// curated table in `evaluate_drug_interactions` can be reused by other flows.
async fn check_interactions_response(
    data: &web::Data<crate::AppState>,
    req: &CheckDrugInteractionsRequest,
    current_user_id: &str,
    interactions: Vec<crate::clinical::DrugInteraction>,
) -> HttpResponse {
    let medications_lower: Vec<String> = req.medications.iter().map(|m| m.to_lowercase()).collect();
    let patient_id = req
        .patient_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    // Allergies belong to a patient; with none named there is nothing to screen.
    let screen_allergies = req.include_allergies.unwrap_or(true) && patient_id.is_some();

    // Check allergies if requested (via repository)
    let mut allergy_alerts: Vec<serde_json::Value> = Vec::new();
    if let (true, Some(patient)) = (screen_allergies, patient_id) {
        let patient_allergies = match data
            .repositories
            .allergies
            .get_active_by_patient(patient)
            .await
        {
            Ok(allergies) => allergies,
            Err(error) => {
                log::error!("Drug check allergy read failed: {error}");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    success: false,
                    error: "Allergy safety data is temporarily unavailable".to_string(),
                    code: "ALLERGY_DATA_UNAVAILABLE".to_string(),
                });
            }
        };
        for allergy in &patient_allergies {
            let allergen_lower = allergy.allergen.to_lowercase();
            for med in &medications_lower {
                if med.contains(&allergen_lower) {
                    allergy_alerts.push(serde_json::json!({
                        "type": "allergy",
                        "medication": med,
                        "allergen": allergy.allergen,
                        "severity": allergy.severity,
                        "reaction": allergy.reaction
                    }));
                }
            }
        }
    }

    // Calculate overall severity
    let overall_severity = interactions
        .iter()
        .map(|i| &i.severity)
        .max()
        .cloned()
        .unwrap_or(crate::clinical::InteractionSeverity::None);

    let safe_to_prescribe = !matches!(
        overall_severity,
        crate::clinical::InteractionSeverity::Contraindicated
            | crate::clinical::InteractionSeverity::Major
    );

    let Some(patient) = patient_id else {
        return interaction_response(req, None, None, &interactions, allergy_alerts, false);
    };
    let result = crate::clinical::DrugInteractionResult {
        result_id: format!("CHK-{}", uuid::Uuid::new_v4()),
        patient_id: patient.to_string(),
        checked_at: chrono::Utc::now().timestamp(),
        new_medication: req.medications.first().cloned().unwrap_or_default(),
        interactions: interactions.clone(),
        overall_severity,
        safe_to_prescribe,
        checked_by: current_user_id.to_string(),
    };

    // Store the result via repository (was: in-memory data.drug_interactions HashMap)
    let check_id = result.result_id.clone();
    {
        let now_dt = chrono::Utc::now();
        let payload = match serde_json::to_value(&result) {
            Ok(value) => value,
            Err(error) => {
                log::error!("Drug interaction result serialization failed: {error}");
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Could not save the drug interaction result".to_string(),
                    code: "DRUG_CHECK_SERIALIZATION_FAILED".to_string(),
                });
            }
        };
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: check_id.clone(),
            owner_id: result.patient_id.clone(),
            data: payload,
            created_at: now_dt,
            updated_at: now_dt,
        };
        if let Err(error) = data
            .repositories
            .drug_interaction_checks
            .create(entity)
            .await
        {
            log::error!("Drug interaction result persistence failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Drug interaction storage is unavailable".to_string(),
                code: "DRUG_CHECK_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    interaction_response(
        req,
        Some(&check_id),
        Some(patient),
        &interactions,
        allergy_alerts,
        screen_allergies,
    )
}

/// The response to one check, filed or not.
///
/// `screened` says what was actually looked at, so a caller cannot read silence
/// as safety: no allergies were screened when no patient was named, and no
/// drug-condition screen exists at all.
fn interaction_response(
    req: &CheckDrugInteractionsRequest,
    check_id: Option<&str>,
    patient_id: Option<&str>,
    interactions: &[crate::clinical::DrugInteraction],
    allergy_alerts: Vec<serde_json::Value>,
    allergies_screened: bool,
) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "check_id": check_id,
        "patient_id": patient_id,
        "medications_checked": req.medications.len(),
        "interactions_found": interactions.len(),
        "has_critical": interactions.iter().any(|i|
            matches!(i.severity, crate::clinical::InteractionSeverity::Contraindicated |
                                  crate::clinical::InteractionSeverity::Major)),
        "interactions": interactions,
        "allergy_alerts": allergy_alerts,
        // What was actually screened, so the caller cannot mistake silence for
        // safety. `conditions` is false because no drug-condition dataset
        // exists; the page asks for it and this is the honest answer.
        "screened": {
            "drug_drug": true,
            "allergies": allergies_screened,
            "conditions": false,
        },
        "recommendation": if interactions.is_empty() && allergy_alerts.is_empty() {
            "No drug-drug or allergy interactions detected. Conditions were not screened."
        } else if interactions.iter().any(|i| matches!(i.severity, crate::clinical::InteractionSeverity::Contraindicated)) {
            "CONTRAINDICATED - Do not prescribe together"
        } else if interactions.iter().any(|i| matches!(i.severity, crate::clinical::InteractionSeverity::Major)) {
            "MAJOR interactions - Consider alternatives"
        } else {
            "Moderate interactions - Monitor patient closely"
        }
    }))
}

/// Get interaction check history for a patient
#[get("/api/interactions/history/{patient_id}")]
pub async fn get_interaction_history(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<crate::pagination::CursorQuery>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let records = match data
        .repositories
        .drug_interaction_checks
        .get_by_owner(&patient_id)
        .await
    {
        Ok(records) => records,
        Err(error) => {
            log::error!("Drug interaction history read failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Drug interaction history is temporarily unavailable".to_string(),
                code: "DRUG_CHECK_HISTORY_UNAVAILABLE".to_string(),
            });
        }
    };
    let (page, next_cursor) =
        crate::pagination::paginate_cursor(&records, query.cursor.as_deref(), query.limit);
    let history: Vec<crate::clinical::DrugInteractionResult> = page
        .into_iter()
        .filter_map(|r| {
            serde_json::from_value::<crate::clinical::DrugInteractionResult>(r.data).ok()
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "checks": history,
        "count": history.len(),
        "next_cursor": next_cursor
    }))
}

#[cfg(test)]
mod interaction_table_tests {
    use super::*;

    #[test]
    fn builtin_data_file_parses_and_has_expected_coverage() {
        let rows = parse_interactions(BUILTIN_INTERACTIONS_JSON)
            .expect("built-in drug_interactions_builtin.json must be valid");
        assert!(
            rows.len() >= 150,
            "expected the curated baseline to retain its ~170 entries, found {}",
            rows.len()
        );
        assert!(rows
            .iter()
            .any(|(a, b, sev, _)| a == "sildenafil" && b == "nitrate" && sev == "contraindicated"));
    }

    #[test]
    fn parse_interactions_rejects_malformed_json() {
        assert!(parse_interactions("{ not valid json").is_err());
        assert!(parse_interactions(r#"{"interactions": [{"drug_a": "x"}]}"#).is_err());
    }

    #[test]
    fn parse_interactions_accepts_a_minimal_overlay_file() {
        let overlay = r#"{
            "interactions": [
                { "drug_a": "acarbose", "drug_b": "octreotide", "severity": "moderate",
                  "description": "Additive glucose-lowering effect; monitor for hypoglycemia" }
            ]
        }"#;
        let rows = parse_interactions(overlay).expect("valid overlay JSON must parse");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "acarbose");
        assert_eq!(rows[0].2, "moderate");
    }

    #[test]
    fn evaluate_drug_interactions_flags_known_contraindicated_pair() {
        let meds = vec![
            "Sildenafil 50mg".to_string(),
            "Nitroglycerin patch".to_string(),
        ];
        let found = evaluate_drug_interactions(&meds);
        assert!(
            found.iter().any(|i| matches!(
                i.severity,
                crate::clinical::InteractionSeverity::Contraindicated
            )),
            "expected sildenafil + nitroglycerin to be flagged contraindicated, got {found:?}"
        );
    }

    #[test]
    fn evaluate_drug_interactions_ignores_unrelated_medications() {
        let meds = vec!["Acetaminophen".to_string(), "Vitamin D3".to_string()];
        let found = evaluate_drug_interactions(&meds);
        assert!(found.is_empty(), "expected no interactions, got {found:?}");
    }
}

/// A check with no patient is a lookup. The page used to send `"UNKNOWN"`, and
/// each such check was filed as history belonging to a patient of that name.
#[cfg(test)]
mod patientless_check_tests {
    use crate::test_fixtures::register;
    use crate::{AppState, Role};
    use actix_web::{test, web, App};

    #[actix_rt::test]
    async fn a_check_without_a_patient_files_nothing_and_says_allergies_were_not_screened() {
        let state = AppState::new();
        register(&state, "5Doctor", Role::Doctor);
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(super::check_drug_interactions),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/interactions/check")
            .insert_header(("X-User-Id", "5Doctor"))
            .set_json(serde_json::json!({
                "medications": ["warfarin", "aspirin"],
                "include_allergies": true
            }))
            .to_request();
        let body: serde_json::Value = test::call_and_read_body_json(&app, req).await;

        assert_eq!(body["success"], true, "{body}");
        assert!(body["check_id"].is_null(), "no chart, no record: {body}");
        assert!(body["patient_id"].is_null(), "{body}");
        assert_eq!(body["screened"]["allergies"], false, "{body}");
        assert!(
            body["interactions_found"].as_u64().unwrap_or(0) > 0,
            "warfarin + aspirin: {body}"
        );
        let stored = data
            .repositories
            .drug_interaction_checks
            .list_all()
            .await
            .expect("list checks");
        assert!(
            stored.is_empty(),
            "a patient-less check was filed: {stored:?}"
        );
    }
}
