//! `clinical_endpoints::clinical_support::cds::engine` — Phase 27 CDS rules engine +
//! shared helpers (threshold loading, alert persistence/audit, patient conditions/meds).
//!
//! Split out of the former single-file `cds.rs` (itself split from `clinical_support.rs`,
//! itself split from the original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1).
//! Inherits shared imports/helpers via `use super::*`; glob-re-exported by `cds/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 27: CLINICAL DECISION SUPPORT (CDS)
// ============================================================================

/// Evaluate Clinical Decision Support rules for a patient based on their current vitals/labs.
/// Returns a list of auto-generated CDS alerts that should be created.
/// Fetch a patient's chronic conditions and current medications (best-effort) so
/// the CDS engine can evaluate drug/condition rules. Returns empty vecs when the
/// patient or profile blob isn't available.
pub async fn patient_conditions_and_meds(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> (Vec<String>, Vec<String>) {
    data.repositories
        .patients
        .get_by_id(patient_id)
        .await
        .ok()
        .and_then(|e| crate::patient_entity_to_profile(&e, &data.encryption_keyring))
        .map(|p| {
            (
                p.emergency_info.chronic_conditions,
                p.emergency_info.current_medications,
            )
        })
        .unwrap_or_default()
}

/// Per-facility-tunable thresholds for the automated CDS rules engine.
///
/// `Default` reproduces the engine's built-in cut-offs exactly, so an absent
/// facility config is behaviour-preserving. `#[serde(default)]` lets a facility
/// override only the fields it cares about — missing keys fall back to default.
/// Numeric types mirror the `VitalSignsReading` fields they are compared against.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct CdsThresholds {
    pub qsofa_rr: u16,
    pub qsofa_sbp: u16,
    pub htn_sbp: u16,
    pub htn_dbp: u16,
    pub shock_sbp: u16,
    pub shock_tachy_hr: u16,
    pub brady_hr: u16,
    pub tachy_hr: u16,
    pub fever_c: f32,
    pub high_fever_c: f32,
    pub hypothermia_c: f32,
    pub hypoxia_spo2: u16,
    pub low_spo2: u16,
    pub aki_creatinine: f64,
    pub hyperkalemia_k: f64,
    pub hyponatremia_na: f64,
    pub critical_hgb: f64,
    pub troponin: f64,
    pub inr_supra: f64,
    pub inr_critical: f64,
    pub lactate_critical: f64,
}

impl Default for CdsThresholds {
    fn default() -> Self {
        Self {
            qsofa_rr: 22,
            qsofa_sbp: 100,
            htn_sbp: 180,
            htn_dbp: 120,
            shock_sbp: 90,
            shock_tachy_hr: 100,
            brady_hr: 50,
            tachy_hr: 130,
            fever_c: 38.5,
            high_fever_c: 40.0,
            hypothermia_c: 35.0,
            hypoxia_spo2: 90,
            low_spo2: 94,
            aki_creatinine: 354.0,
            hyperkalemia_k: 6.5,
            hyponatremia_na: 120.0,
            critical_hgb: 70.0,
            troponin: 0.04,
            inr_supra: 4.0,
            inr_critical: 9.0,
            lactate_critical: 4.0,
        }
    }
}

/// Load the CDS thresholds for a facility (falls back to engine defaults when no
/// facility is given or no config row exists / it fails to deserialize).
pub async fn load_cds_thresholds(
    data: &web::Data<AppState>,
    facility_id: Option<&str>,
) -> CdsThresholds {
    let Some(fid) = facility_id else {
        return CdsThresholds::default();
    };
    match data.repositories.cds_threshold_configs.get_by_id(fid).await {
        Ok(Some(rec)) => serde_json::from_value(rec.data).unwrap_or_default(),
        _ => CdsThresholds::default(),
    }
}

/// Run the CDS rules engine for a patient and persist + broadcast any new alerts.
///
/// Applies simple alert-fatigue suppression: an alert is skipped when an active
/// alert with the same title already exists for the patient (and duplicates within
/// a single evaluation are collapsed). Shared by every handler that triggers CDS
/// (vital signs, lab results, medication administration, nursing assessments).
///
/// `facility_id` selects the facility's configured thresholds (Phase 4.3); `None`
/// uses the engine defaults. Every fired and every suppressed alert is recorded in
/// the CDS audit trail (which rule fired, the outcome, and the threshold snapshot).
pub async fn run_and_persist_cds_alerts(
    data: &web::Data<AppState>,
    patient_id: &str,
    vitals: Option<&crate::clinical::VitalSignsReading>,
    lab_values: Option<&std::collections::HashMap<String, f64>>,
    conditions: &[String],
    medications: &[String],
    facility_id: Option<&str>,
) {
    let thresholds = load_cds_thresholds(data, facility_id).await;
    let alerts = evaluate_cds_rules(
        patient_id,
        vitals,
        lab_values,
        conditions,
        medications,
        &thresholds,
    );
    if alerts.is_empty() {
        return;
    }
    // Active alert titles already on file for this patient (fatigue suppression).
    let existing: std::collections::HashSet<String> = data
        .repositories
        .cds_alerts
        .get_by_patient(patient_id, true)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|a| a.alert_title)
        .collect();
    let thresholds_snapshot = serde_json::to_value(&thresholds).unwrap_or_default();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for alert in &alerts {
        let suppressed = !seen.insert(alert.title.clone()) || existing.contains(&alert.title);
        record_cds_audit(
            data,
            alert,
            facility_id,
            if suppressed { "suppressed" } else { "fired" },
            &thresholds_snapshot,
        )
        .await;
        if suppressed {
            continue; // duplicate within this batch, or already an active alert
        }
        log::info!(
            "CDS alert fired for patient {}: {}",
            patient_id,
            alert.alert_id
        );
        crate::websocket::push_cds_alert(
            &data.ws_manager,
            patient_id,
            &alert.title,
            &format!("{:?}", alert.severity),
        );
        // FCM push for genuinely emergent alerts only — High/Critical, not
        // Informational/Low/Medium, to avoid compounding alert fatigue onto the push channel too.
        if matches!(
            alert.severity,
            crate::clinical::CDSSeverity::High | crate::clinical::CDSSeverity::Critical
        ) {
            let repos = data.repositories.clone();
            let recipient = patient_id.to_string();
            let title = alert.title.clone();
            tokio::spawn(async move {
                let _ = crate::notifications::send_push_to_user(
                    &repos,
                    crate::notifications::PushNotification {
                        user_id: recipient,
                        title: "Clinical Alert".to_string(),
                        body: title,
                        data: Some([("type".to_string(), "cds_alert".to_string())].into()),
                    },
                )
                .await;
            });
        }
        let entity: crate::repositories::traits::CdsAlertEntity = alert.clone().into();
        if let Err(e) = data.repositories.cds_alerts.create(entity).await {
            log::error!("Failed to persist CDS alert: {}", e);
        }
    }
}

/// Append one CDS audit-trail entry (rule fired / suppressed) for a patient.
async fn record_cds_audit(
    data: &web::Data<AppState>,
    alert: &crate::clinical::CDSAlert,
    facility_id: Option<&str>,
    outcome: &str,
    thresholds_snapshot: &serde_json::Value,
) {
    let now = chrono::Utc::now();
    let entry = serde_json::json!({
        "rule_id": alert.alert_id,
        "alert_type": format!("{:?}", alert.alert_type),
        "alert_title": alert.title,
        "severity": format!("{:?}", alert.severity),
        "outcome": outcome,
        "facility_id": facility_id,
        "patient_id": alert.patient_id,
        "thresholds_snapshot": thresholds_snapshot,
        "recorded_at": now.to_rfc3339(),
    });
    let record = crate::repositories::traits::JsonRecordEntity {
        id: format!("CDSAUDIT-{}", uuid::Uuid::new_v4()),
        owner_id: alert.patient_id.clone(),
        data: entry,
        created_at: now,
        updated_at: now,
    };
    if let Err(e) = data.repositories.cds_audit_entries.create(record).await {
        log::error!(
            "Failed to persist CDS audit entry for {}: {}",
            alert.alert_id,
            e
        );
    }
}

pub fn evaluate_cds_rules(
    patient_id: &str,
    vitals: Option<&crate::clinical::VitalSignsReading>,
    lab_values: Option<&std::collections::HashMap<String, f64>>,
    patient_conditions: &[String],
    current_medications: &[String],
    t: &CdsThresholds,
) -> Vec<crate::clinical::CDSAlert> {
    let mut alerts = Vec::new();
    let now = chrono::Utc::now().timestamp();

    // Helper closure for creating alerts
    let make_alert = |id_suffix: &str,
                      alert_type: crate::clinical::CDSAlertType,
                      title: &str,
                      description: &str,
                      severity: crate::clinical::CDSSeverity,
                      recommendation: &str|
     -> crate::clinical::CDSAlert {
        crate::clinical::CDSAlert {
            alert_id: format!("AUTO-CDS-{}-{}", id_suffix, uuid::Uuid::new_v4()),
            patient_id: patient_id.to_string(),
            provider_id: "cds_rules_engine".to_string(),
            alert_type,
            severity,
            title: title.to_string(),
            description: description.to_string(),
            clinical_context: "Automated CDS rules evaluation".to_string(),
            triggering_data: serde_json::json!({ "source": "automated_rules_engine" }),
            recommended_actions: vec![crate::clinical::CDSRecommendedAction {
                action_id: format!("ACT-{}", uuid::Uuid::new_v4()),
                action_type: "clinical_action".to_string(),
                description: recommendation.to_string(),
                strength: crate::clinical::RecommendationStrength::Strong,
                one_click_order: None,
            }],
            evidence: vec![crate::clinical::CDSEvidence {
                source: "CDS Rules Engine".to_string(),
                citation: "Clinical decision support automated rule".to_string(),
                url: None,
                evidence_grade: "A".to_string(),
            }],
            guideline_reference: None,
            created_at: now,
            expires_at: None,
            status: crate::clinical::CDSAlertStatus::Active,
            response: None,
        }
    };

    // --- VITAL SIGNS RULES ---
    if let Some(v) = vitals {
        // Sepsis screening (qSOFA criteria) — using available fields
        let mut qsofa_score = 0;
        if let Some(rr) = v.respiratory_rate {
            if rr >= t.qsofa_rr {
                qsofa_score += 1;
            }
        }
        if let Some(sbp) = v.systolic_bp {
            if sbp <= t.qsofa_sbp {
                qsofa_score += 1;
            }
        }
        if qsofa_score >= 2 {
            alerts.push(make_alert(
                "SEPSIS",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "Sepsis Alert - qSOFA \u{2265} 2",
                &format!(
                    "qSOFA score: {}. Criteria met: RR\u{2265}{}:{}, SBP\u{2264}{}:{}",
                    qsofa_score,
                    t.qsofa_rr,
                    v.respiratory_rate.map(|r| r >= t.qsofa_rr).unwrap_or(false),
                    t.qsofa_sbp,
                    v.systolic_bp.map(|s| s <= t.qsofa_sbp).unwrap_or(false),
                ),
                crate::clinical::CDSSeverity::Critical,
                "Initiate sepsis bundle: blood cultures x2, lactate, broad-spectrum antibiotics within 1 hour, 30mL/kg IV crystalloid if hypotensive",
            ));
        }

        // Hypertensive crisis
        if let (Some(sbp), Some(dbp)) = (v.systolic_bp, v.diastolic_bp) {
            if sbp >= t.htn_sbp || dbp >= t.htn_dbp {
                alerts.push(make_alert(
                    "HTNCRISIS",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Hypertensive Crisis",
                    &format!("BP: {}/{} mmHg", sbp, dbp),
                    crate::clinical::CDSSeverity::Critical,
                    "Assess for end-organ damage. IV labetalol or nicardipine if hypertensive emergency. Oral agents if urgency only.",
                ));
            }
        }

        // Hypotensive shock
        if let Some(sbp) = v.systolic_bp {
            if sbp < t.shock_sbp {
                let hr_tachycardia = v.heart_rate.map(|h| h > t.shock_tachy_hr).unwrap_or(false);
                alerts.push(make_alert(
                    "HYPOSHOCK",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    if hr_tachycardia { "Shock - Hypotension + Tachycardia" } else { "Hypotension Alert" },
                    &format!("SBP: {} mmHg{}", sbp, if hr_tachycardia { ", HR >100 bpm" } else { "" }),
                    if hr_tachycardia { crate::clinical::CDSSeverity::Critical } else { crate::clinical::CDSSeverity::High },
                    "IV access x2, fluid resuscitation, determine shock type (septic/hemorrhagic/cardiogenic/distributive), consider vasopressors",
                ));
            }
        }

        // Bradycardia
        if let Some(hr) = v.heart_rate {
            if hr < t.brady_hr {
                alerts.push(make_alert(
                    "BRADY",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Severe Bradycardia",
                    &format!("HR: {} bpm", hr),
                    crate::clinical::CDSSeverity::High,
                    "12-lead ECG, assess for AV block, consider atropine 0.5mg IV if symptomatic",
                ));
            }
            // Tachycardia
            if hr > t.tachy_hr {
                alerts.push(make_alert(
                    "TACHY",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Severe Tachycardia",
                    &format!("HR: {} bpm", hr),
                    crate::clinical::CDSSeverity::High,
                    "12-lead ECG, identify and treat underlying cause, consider rate control if stable",
                ));
            }
        }

        // Fever
        if let Some(temp) = v.temperature_celsius {
            if temp >= t.fever_c {
                let severity = if temp >= t.high_fever_c {
                    crate::clinical::CDSSeverity::Critical
                } else {
                    crate::clinical::CDSSeverity::High
                };
                alerts.push(make_alert(
                    "FEVER",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Fever Alert",
                    &format!("Temperature: {:.1}\u{00b0}C", temp),
                    severity,
                    if temp >= t.high_fever_c {
                        "High fever - blood cultures, CBC, CMP, consider LP if meningeal signs, aggressive antipyretics, cooling measures"
                    } else {
                        "Fever - blood cultures if bacteremia suspected, CBC, antipyretics, investigate source"
                    },
                ));
            }
            if temp < t.hypothermia_c {
                alerts.push(make_alert(
                    "HYPOTHERMIA",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Hypothermia Alert",
                    &format!("Temperature: {:.1}\u{00b0}C", temp),
                    crate::clinical::CDSSeverity::Critical,
                    "Active warming, monitor for cardiac arrhythmias, check glucose, thyroid function",
                ));
            }
        }

        // Hypoxia
        if let Some(spo2) = v.oxygen_saturation {
            if spo2 < t.hypoxia_spo2 {
                alerts.push(make_alert(
                    "HYPOXIA",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Critical Hypoxia",
                    &format!("SpO2: {}%", spo2),
                    crate::clinical::CDSSeverity::Critical,
                    "Supplemental O2 immediately, ABG, CXR, assess for PE/pneumonia/ARDS, prepare for intubation if refractory",
                ));
            } else if spo2 < t.low_spo2 {
                alerts.push(make_alert(
                    "LOWSPO2",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Low Oxygen Saturation",
                    &format!("SpO2: {}%", spo2),
                    crate::clinical::CDSSeverity::High,
                    "Supplemental O2, assess work of breathing, ABG, CXR",
                ));
            }
        }
    }

    // --- LAB VALUE RULES ---
    if let Some(labs) = lab_values {
        // Acute Kidney Injury
        if let Some(&creatinine) = labs.get("creatinine") {
            if creatinine > t.aki_creatinine {
                // >4 mg/dL in µmol/L
                alerts.push(make_alert(
                    "AKI",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Severe AKI - Critical Creatinine",
                    &format!("Creatinine: {:.0} \u{00b5}mol/L", creatinine),
                    crate::clinical::CDSSeverity::Critical,
                    "Nephrology consult, hold nephrotoxins, strict fluid balance, consider renal replacement therapy",
                ));
            }
        }

        // Hyperkalemia
        if let Some(&potassium) = labs.get("potassium") {
            if potassium > t.hyperkalemia_k {
                alerts.push(make_alert(
                    "HYPERK",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Hyperkalemia",
                    &format!("K+: {:.1} mmol/L", potassium),
                    crate::clinical::CDSSeverity::Critical,
                    "ECG immediately, calcium gluconate 1g IV, insulin 10u + D50W, sodium bicarbonate if acidotic, consider Kayexalate or dialysis",
                ));
            }
        }

        // Hyponatremia
        if let Some(&sodium) = labs.get("sodium") {
            if sodium < t.hyponatremia_na {
                alerts.push(make_alert(
                    "HYPONATR",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Severe Hyponatremia",
                    &format!("Na+: {:.0} mmol/L", sodium),
                    crate::clinical::CDSSeverity::Critical,
                    "Neurology consult, 3% NaCl if symptomatic (seizures/altered MS), correct no faster than 8-12 mEq/L per 24h to avoid osmotic demyelination",
                ));
            }
        }

        // Critical hemoglobin
        if let Some(&hgb) = labs.get("hemoglobin") {
            if hgb < t.critical_hgb {
                // < 7 g/dL in g/L
                alerts.push(make_alert(
                    "CRITANEMIA",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Anemia",
                    &format!("Hemoglobin: {:.0} g/L", hgb),
                    crate::clinical::CDSSeverity::Critical,
                    "Transfusion threshold met, type and crossmatch, consider transfusion if symptomatic, identify bleeding source",
                ));
            }
        }

        // Troponin elevation
        if let Some(&troponin) = labs.get("troponin") {
            if troponin > t.troponin {
                // ng/mL
                alerts.push(make_alert(
                    "TROPONIN",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Elevated Troponin - ACS Suspected",
                    &format!("Troponin: {:.3} ng/mL", troponin),
                    crate::clinical::CDSSeverity::Critical,
                    "12-lead ECG, cardiology consult, aspirin 325mg, anticoagulation, serial troponins at 3h, consider cath lab activation",
                ));
            }
        }

        // INR supratherapeutic
        if let Some(&inr) = labs.get("inr") {
            if inr > t.inr_supra {
                alerts.push(make_alert(
                    "SUPRAINR",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Supratherapeutic INR",
                    &format!("INR: {:.1}", inr),
                    crate::clinical::CDSSeverity::High,
                    if inr > t.inr_critical {
                        "Hold warfarin, Vitamin K 10mg IV, consider 4-factor PCC if active bleeding"
                    } else {
                        "Hold warfarin, Vitamin K 2.5-5mg PO, repeat INR in 24h"
                    },
                ));
            }
        }

        // Lactic acidosis
        if let Some(&lactate) = labs.get("lactate") {
            if lactate > t.lactate_critical {
                alerts.push(make_alert(
                    "LACTATCRIT",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Lactic Acidosis",
                    &format!("Lactate: {:.1} mmol/L", lactate),
                    crate::clinical::CDSSeverity::Critical,
                    "Identify underlying cause (sepsis, mesenteric ischemia, hepatic failure), aggressive resuscitation, repeat lactate in 2h",
                ));
            }
        }
    }

    // --- MEDICATION SAFETY RULES ---
    let meds_lower: Vec<String> = current_medications
        .iter()
        .map(|m| m.to_lowercase())
        .collect();

    // Anticoagulation fall risk
    if meds_lower.iter().any(|m| {
        m.contains("warfarin")
            || m.contains("heparin")
            || m.contains("rivaroxaban")
            || m.contains("apixaban")
            || m.contains("dabigatran")
    }) && patient_conditions
        .iter()
        .any(|c| c.to_lowercase().contains("fall") || c.to_lowercase().contains("dementia"))
    {
        alerts.push(make_alert(
                "ANTICOAGFALL",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "High Bleeding Risk - Anticoagulation + Fall Risk",
                "Patient on anticoagulant with documented fall risk or dementia",
                crate::clinical::CDSSeverity::High,
                "Fall prevention protocol, bed alarm, consider dose reduction, ensure INR/anti-Xa monitoring in place",
            ));
    }

    // NSAIDs in renal impairment
    if meds_lower.iter().any(|m| {
        m.contains("ibuprofen")
            || m.contains("naproxen")
            || m.contains("diclofenac")
            || m.contains("indomethacin")
    }) && patient_conditions.iter().any(|c| {
        c.to_lowercase().contains("renal")
            || c.to_lowercase().contains("kidney")
            || c.to_lowercase().contains("ckd")
    }) {
        alerts.push(make_alert(
                "NSAIDRENAL",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "NSAID Use in Renal Impairment",
                "Patient has renal disease and is receiving NSAID",
                crate::clinical::CDSSeverity::High,
                "Consider paracetamol/acetaminophen instead. If NSAID necessary, use lowest dose for shortest duration with close renal monitoring",
            ));
    }

    alerts
}

/// Create CDS alert request
#[derive(Debug, Deserialize)]
pub struct CreateCDSAlertRequest {
    pub patient_id: String,
    pub alert_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub clinical_context: String,
    pub guideline_reference: Option<String>,
    pub expires_at: Option<i64>,
}
