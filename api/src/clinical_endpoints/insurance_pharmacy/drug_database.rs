//! `clinical_endpoints::insurance_pharmacy::drug_database` — Phase 21 static reference data
//! (drug database, interaction database) backing the drug-interaction checker.
//!
//! Split out of the former single-file `insurance_pharmacy.rs` (itself split from the
//! original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `insurance_pharmacy/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 21: DRUG INTERACTION CHECKING
// ============================================================================

/// Get drug database for lookup/search
#[get("/api/drugs")]
pub async fn get_drug_database(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // Validate user is authenticated
    let _current_user_id = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    // Drug reference database (clinical formulary)
    let drugs = vec![
        crate::clinical::DrugReference {
            drug_id: "DRUG-001".to_string(),
            name: "Warfarin".to_string(),
            generic_name: "warfarin".to_string(),
            brand_names: vec!["Coumadin".to_string(), "Jantoven".to_string()],
            drug_class: "Anticoagulant".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "1mg".to_string(),
                "2mg".to_string(),
                "2.5mg".to_string(),
                "3mg".to_string(),
                "4mg".to_string(),
                "5mg".to_string(),
                "6mg".to_string(),
                "7.5mg".to_string(),
                "10mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-002".to_string(),
            name: "Aspirin".to_string(),
            generic_name: "aspirin".to_string(),
            brand_names: vec![
                "Bayer".to_string(),
                "Ecotrin".to_string(),
                "Bufferin".to_string(),
            ],
            drug_class: "NSAID/Antiplatelet".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec!["81mg".to_string(), "325mg".to_string(), "500mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-003".to_string(),
            name: "Lisinopril".to_string(),
            generic_name: "lisinopril".to_string(),
            brand_names: vec!["Prinivil".to_string(), "Zestril".to_string()],
            drug_class: "ACE Inhibitor".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "2.5mg".to_string(),
                "5mg".to_string(),
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-004".to_string(),
            name: "Metformin".to_string(),
            generic_name: "metformin".to_string(),
            brand_names: vec![
                "Glucophage".to_string(),
                "Fortamet".to_string(),
                "Glumetza".to_string(),
            ],
            drug_class: "Biguanide".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "500mg".to_string(),
                "850mg".to_string(),
                "1000mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-005".to_string(),
            name: "Amoxicillin".to_string(),
            generic_name: "amoxicillin".to_string(),
            brand_names: vec!["Amoxil".to_string(), "Moxatag".to_string()],
            drug_class: "Penicillin Antibiotic".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec![
                "250mg".to_string(),
                "500mg".to_string(),
                "875mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-006".to_string(),
            name: "Simvastatin".to_string(),
            generic_name: "simvastatin".to_string(),
            brand_names: vec!["Zocor".to_string()],
            drug_class: "Statin".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "5mg".to_string(),
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
                "80mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-007".to_string(),
            name: "Omeprazole".to_string(),
            generic_name: "omeprazole".to_string(),
            brand_names: vec!["Prilosec".to_string(), "Losec".to_string()],
            drug_class: "Proton Pump Inhibitor".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec!["10mg".to_string(), "20mg".to_string(), "40mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-008".to_string(),
            name: "Levothyroxine".to_string(),
            generic_name: "levothyroxine".to_string(),
            brand_names: vec![
                "Synthroid".to_string(),
                "Levoxyl".to_string(),
                "Unithroid".to_string(),
            ],
            drug_class: "Thyroid Hormone".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "25mcg".to_string(),
                "50mcg".to_string(),
                "75mcg".to_string(),
                "88mcg".to_string(),
                "100mcg".to_string(),
                "112mcg".to_string(),
                "125mcg".to_string(),
                "137mcg".to_string(),
                "150mcg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-009".to_string(),
            name: "Amlodipine".to_string(),
            generic_name: "amlodipine".to_string(),
            brand_names: vec!["Norvasc".to_string()],
            drug_class: "Calcium Channel Blocker".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec!["2.5mg".to_string(), "5mg".to_string(), "10mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-010".to_string(),
            name: "Fluoxetine".to_string(),
            generic_name: "fluoxetine".to_string(),
            brand_names: vec!["Prozac".to_string(), "Sarafem".to_string()],
            drug_class: "SSRI Antidepressant".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec![
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
                "60mg".to_string(),
            ],
        },
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "drugs": drugs,
        "count": drugs.len()
    }))
}

/// Get interaction database for reference/lookup
#[get("/api/interactions")]
pub async fn get_interaction_database(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // Validate user is authenticated
    let _current_user_id = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    // Reference interaction database
    let interactions = vec![
        serde_json::json!({
            "interactionId": "INT-001",
            "type": "drug-drug",
            "severity": "major",
            "drug1": "Warfarin",
            "drug2": "Aspirin",
            "title": "Warfarin + Aspirin: Increased Bleeding Risk",
            "description": "Concurrent use of warfarin with aspirin significantly increases the risk of bleeding complications.",
            "mechanism": "Additive anticoagulant and antiplatelet effects. Both drugs inhibit different pathways in hemostasis, leading to synergistic bleeding risk.",
            "clinicalEffects": ["Increased risk of major bleeding (GI, intracranial)", "Prolonged bleeding time", "Elevated INR", "Easy bruising", "Hematuria or melena"],
            "management": ["Avoid combination when possible", "If combination necessary, use lowest effective aspirin dose (81mg)", "Monitor INR more frequently (weekly initially)", "Watch for signs of bleeding", "Consider PPI for GI protection", "Educate patient on bleeding signs"],
            "monitoring": ["INR every 1-2 weeks until stable", "CBC for anemia", "Stool guaiac for occult blood", "Monitor for bruising, bleeding gums"],
            "alternatives": ["Use aspirin alone for cardiovascular protection if anticoagulation can be stopped", "Consider alternative anticoagulant if aspirin essential"],
            "evidenceLevel": "A",
            "references": ["Holbrook AM, et al. Arch Intern Med. 2005;165(10):1095-1106.", "Johnson SG, et al. Am Heart J. 2008;155(5):918-924."],
            "onset": "Immediate (within days)",
            "documentation": "Well-established",
            "riskFactors": ["Age >65", "History of bleeding", "Renal impairment", "Peptic ulcer disease"]
        }),
        serde_json::json!({
            "interactionId": "INT-002",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Lisinopril",
            "drug2": "Aspirin",
            "title": "ACE Inhibitors + NSAIDs: Reduced Antihypertensive Effect",
            "description": "NSAIDs may reduce the antihypertensive effect of ACE inhibitors and increase risk of renal impairment.",
            "mechanism": "NSAIDs inhibit prostaglandin synthesis, which is important for ACE inhibitor-mediated vasodilation and natriuresis.",
            "clinicalEffects": ["Reduced blood pressure control", "Increased risk of acute kidney injury", "Hyperkalemia", "Sodium and fluid retention"],
            "management": ["Monitor blood pressure closely", "Check renal function and potassium", "Use lowest effective NSAID dose for shortest duration", "Consider alternative analgesic (acetaminophen)"],
            "monitoring": ["Blood pressure weekly during NSAID therapy", "Serum creatinine and potassium baseline and after 1 week", "Volume status"],
            "alternatives": ["Acetaminophen for pain", "Topical NSAIDs", "COX-2 selective inhibitor (caution still needed)"],
            "evidenceLevel": "B",
            "references": ["Fournier JP, et al. BMJ. 2012;344:e4128.", "Lapi F, et al. Drug Saf. 2013;36(10):899-918."],
            "onset": "Days to weeks",
            "documentation": "Established",
            "riskFactors": ["Pre-existing renal disease", "Volume depletion", "Age >65", "Diabetes"]
        }),
        serde_json::json!({
            "interactionId": "INT-003",
            "type": "drug-drug",
            "severity": "major",
            "drug1": "Simvastatin",
            "drug2": "Fluoxetine",
            "title": "Simvastatin + Fluoxetine: Increased Statin Levels",
            "description": "Fluoxetine inhibits CYP3A4, increasing simvastatin levels and risk of myopathy/rhabdomyolysis.",
            "mechanism": "Fluoxetine is a moderate CYP3A4 inhibitor. Simvastatin is extensively metabolized by CYP3A4.",
            "clinicalEffects": ["Increased simvastatin plasma concentrations", "Myalgia and muscle weakness", "Elevated creatine kinase (CK)", "Rhabdomyolysis (rare but serious)", "Acute kidney injury from myoglobinuria"],
            "management": ["Reduce simvastatin dose (max 20mg daily with moderate CYP3A4 inhibitor)", "Monitor for muscle symptoms", "Check CK if symptoms develop", "Consider alternative statin not metabolized by CYP3A4 (rosuvastatin, pravastatin)"],
            "monitoring": ["Baseline CK", "Patient education on myopathy symptoms", "CK if muscle pain/weakness", "Renal function"],
            "alternatives": ["Switch to rosuvastatin or pravastatin", "Switch to alternative SSRI with less CYP3A4 inhibition (sertraline)"],
            "evidenceLevel": "B",
            "references": ["FDA Drug Safety Communication on Simvastatin", "Law M, Rudnicka AR. Am J Cardiovasc Drugs. 2006;6(6):343-348."],
            "onset": "Days to weeks",
            "documentation": "Established",
            "riskFactors": ["High simvastatin dose", "Renal impairment", "Hypothyroidism", "Age >65", "Female gender"]
        }),
        serde_json::json!({
            "interactionId": "INT-004",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Metformin",
            "drug2": "Lisinopril",
            "title": "Metformin + ACE Inhibitors: Hypoglycemia Risk",
            "description": "ACE inhibitors may enhance the hypoglycemic effect of metformin.",
            "mechanism": "ACE inhibitors may improve insulin sensitivity and glucose uptake.",
            "clinicalEffects": ["Increased risk of hypoglycemia", "Enhanced glucose-lowering effect", "Symptoms: tremor, sweating, confusion, tachycardia"],
            "management": ["Monitor blood glucose more frequently when initiating ACE inhibitor", "Educate patient on hypoglycemia symptoms", "May need to adjust metformin or other antidiabetic dose", "Generally beneficial interaction for diabetic patients"],
            "monitoring": ["Blood glucose daily initially", "HbA1c at 3 months", "Hypoglycemia symptoms"],
            "alternatives": ["Generally continue both medications", "Adjust doses as needed based on glucose control"],
            "evidenceLevel": "C",
            "references": ["Paolisso G, et al. J Clin Invest. 1992;89(4):1295-1300."],
            "onset": "Days to weeks",
            "documentation": "Probable",
            "riskFactors": ["Elderly", "Renal impairment", "Tight glycemic control", "Irregular meals"]
        }),
        serde_json::json!({
            "interactionId": "INT-005",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Levothyroxine",
            "drug2": "Omeprazole",
            "title": "Levothyroxine + PPIs: Reduced Levothyroxine Absorption",
            "description": "PPIs increase gastric pH, which may reduce levothyroxine absorption.",
            "mechanism": "Levothyroxine absorption is pH-dependent. Increased gastric pH from PPI reduces dissolution and absorption.",
            "clinicalEffects": ["Reduced levothyroxine efficacy", "Elevated TSH", "Hypothyroid symptoms may recur"],
            "management": ["Separate administration by at least 4 hours", "Take levothyroxine first thing in the morning on empty stomach", "Take PPI later in the day", "Monitor TSH 6-8 weeks after PPI initiation", "May need to increase levothyroxine dose"],
            "monitoring": ["TSH and free T4 at 6-8 weeks", "Clinical symptoms of hypothyroidism"],
            "alternatives": ["H2 antagonist instead of PPI if appropriate", "Antacids (though also affect absorption)"],
            "evidenceLevel": "C",
            "references": ["Centanni M, et al. N Engl J Med. 2006;354(17):1787-1795."],
            "onset": "Weeks",
            "documentation": "Probable",
            "riskFactors": ["Marginal thyroid function", "High PPI dose", "Long-term PPI use"]
        }),
        serde_json::json!({
            "interactionId": "INT-006",
            "type": "drug-allergy",
            "severity": "contraindicated",
            "drug1": "Amoxicillin",
            "allergen": "Penicillin",
            "title": "Amoxicillin in Penicillin-Allergic Patients",
            "description": "Absolute contraindication to use amoxicillin (a penicillin) in patients with documented penicillin allergy.",
            "mechanism": "Cross-reactivity due to shared beta-lactam ring structure.",
            "clinicalEffects": ["Immediate hypersensitivity reaction", "Urticaria, angioedema", "Bronchospasm", "Anaphylaxis (life-threatening)", "Stevens-Johnson syndrome (rare)"],
            "management": ["DO NOT ADMINISTER", "Use alternative antibiotic class", "If beta-lactam essential, consider allergy testing and possible desensitization", "Update allergy list in medical record"],
            "monitoring": ["N/A - do not use"],
            "alternatives": ["Macrolides (azithromycin, clarithromycin)", "Fluoroquinolones (levofloxacin, moxifloxacin)", "Cephalosporins (use with caution, 1-10% cross-reactivity)"],
            "evidenceLevel": "A",
            "references": ["Joint Task Force on Practice Parameters. J Allergy Clin Immunol. 2010;125(3 Suppl 2):S126-137."],
            "onset": "Immediate to hours",
            "documentation": "Well-established",
            "riskFactors": ["History of severe reaction", "Atopy", "Previous penicillin reaction"]
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "interactions": interactions,
        "count": interactions.len()
    }))
}
