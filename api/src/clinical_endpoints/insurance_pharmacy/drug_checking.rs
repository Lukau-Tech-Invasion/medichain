//! `clinical_endpoints::insurance_pharmacy::drug_checking` — Phase 21 drug-interaction
//! checking logic (consumes the reference data in `drug_database.rs`).
//!
//! Split out of the former single-file `insurance_pharmacy.rs` (itself split from the
//! original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `insurance_pharmacy/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Check drug interactions request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct CheckDrugInteractionsRequest {
    pub patient_id: String,
    pub medications: Vec<String>,
    pub include_allergies: Option<bool>,
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

    // Check allergies if requested (via repository)
    let mut allergy_alerts: Vec<serde_json::Value> = Vec::new();
    if req.include_allergies.unwrap_or(true) {
        let patient_allergies = data
            .repositories
            .allergies
            .get_active_by_patient(&req.patient_id)
            .await
            .unwrap_or_default();
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

    let result = crate::clinical::DrugInteractionResult {
        result_id: format!("CHK-{}", uuid::Uuid::new_v4()),
        patient_id: req.patient_id.clone(),
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
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: check_id.clone(),
            owner_id: result.patient_id.clone(),
            data: serde_json::to_value(&result).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data
            .repositories
            .drug_interaction_checks
            .create(entity)
            .await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "check_id": check_id,
        "patient_id": req.patient_id,
        "medications_checked": req.medications.len(),
        "interactions_found": interactions.len(),
        "has_critical": interactions.iter().any(|i|
            matches!(i.severity, crate::clinical::InteractionSeverity::Contraindicated |
                                  crate::clinical::InteractionSeverity::Major)),
        "interactions": interactions,
        "allergy_alerts": allergy_alerts,
        "recommendation": if interactions.is_empty() && allergy_alerts.is_empty() {
            "No significant interactions detected"
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

    let records = data
        .repositories
        .drug_interaction_checks
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default();
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
