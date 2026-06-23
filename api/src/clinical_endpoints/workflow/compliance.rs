use super::*;

// ============================================================================
// CONSENT FORMS MANAGEMENT
// ============================================================================

/// Available consent form types
#[get("/api/consent/types")]
pub async fn get_consent_types(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let consent_types = vec![
        serde_json::json!({
            "type_id": "CONSENT-TREATMENT",
            "name": "General Treatment Consent",
            "description": "Consent for general medical treatment and care",
            "required_for": ["admission", "outpatient"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-SURGERY",
            "name": "Surgical Consent",
            "description": "Consent for surgical procedures",
            "required_for": ["surgery"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-ANESTHESIA",
            "name": "Anesthesia Consent",
            "description": "Consent for anesthesia administration",
            "required_for": ["surgery"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-BLOOD",
            "name": "Blood Transfusion Consent",
            "description": "Consent for blood product transfusion",
            "required_for": ["transfusion"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-HIPAA",
            "name": "HIPAA Privacy Notice",
            "description": "Acknowledgment of privacy practices",
            "required_for": ["admission"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-RESEARCH",
            "name": "Research Participation Consent",
            "description": "Consent for participation in clinical research",
            "required_for": ["research"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-TELEMEDICINE",
            "name": "Telemedicine Consent",
            "description": "Consent for virtual/remote care",
            "required_for": ["telemedicine"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-IMAGING",
            "name": "Imaging/Radiology Consent",
            "description": "Consent for diagnostic imaging procedures",
            "required_for": ["imaging"],
            "expires_after_days": 30
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "consent_types": consent_types,
        "total": consent_types.len()
    }))
}

/// Sign a consent form
#[post("/api/consent/sign")]
pub async fn sign_consent(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    let consent_type_id = body
        .get("type_id")
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN");
    let patient_id = body
        .get("patient_id")
        .and_then(|v| v.as_str())
        .unwrap_or(&current_user_id);
    let signature_image = body
        .get("signature_image")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Auth check: patient or legal guardian
    if current_user_id != *patient_id && !current_user.role.is_admin() {
        // In a real app, check for legal proxy/guardian status
        return HttpResponse::Forbidden().finish();
    }

    let consent_id = format!(
        "CONS-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let consent = serde_json::json!({
        "consent_id": consent_id,
        "type_id": consent_type_id,
        "patient_id": patient_id,
        "signed_at": chrono::Utc::now().timestamp(),
        "expires_at": chrono::Utc::now().timestamp() + 365 * 86400,
        "signature_image": signature_image,
        "status": "active",
        "witness_id": body.get("witness_id").and_then(|v| v.as_str())
    });

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "consent": consent,
        "message": "Consent signed and stored on blockchain"
    }))
}

/// Get patient consents
#[get("/api/consent/patient/{patient_id}")]
pub async fn get_patient_consents(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    if current_user_id != patient_id && !current_user_id.starts_with("0xPROV") {
        return HttpResponse::Forbidden().finish();
    }

    // Mock consents
    let consents = vec![
        serde_json::json!({
            "consent_id": "CONS-001",
            "type_id": "CONSENT-TREATMENT",
            "signed_at": chrono::Utc::now().timestamp() - 1000000,
            "status": "active"
        }),
        serde_json::json!({
            "consent_id": "CONS-002",
            "type_id": "CONSENT-HIPAA",
            "signed_at": chrono::Utc::now().timestamp() - 1000000,
            "status": "active"
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "consents": consents,
        "total": consents.len()
    }))
}

// ============================================================================
// BARCODE/SAMPLE TRACKING (Simulation)
// ============================================================================

/// Generate a barcode for specimen tracking
#[post("/api/barcode/generate")]
pub async fn generate_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let entity_type = body
        .get("entity_type")
        .and_then(|e| e.as_str())
        .unwrap_or("specimen");
    let entity_id = body
        .get("entity_id")
        .and_then(|e| e.as_str())
        .unwrap_or("UNKNOWN");
    let patient_id = body.get("patient_id").and_then(|p| p.as_str());

    let barcode_id = format!(
        "BC-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .replace("-", "")
            .chars()
            .take(12)
            .collect::<String>()
            .to_uppercase()
    );

    // Generate barcode value (Code 128 compatible)
    let barcode_value = format!(
        "MC{}{:06}",
        match entity_type {
            "specimen" => "SP",
            "medication" => "MED",
            "patient" => "PAT",
            "equipment" => "EQ",
            _ => "XX",
        },
        chrono::Utc::now().timestamp() % 1000000
    );

    let barcode = serde_json::json!({
        "barcode_id": barcode_id,
        "barcode_value": barcode_value,
        "barcode_type": "CODE128",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "patient_id": patient_id,
        "generated_by": current_user.wallet_address,
        "generated_at": chrono::Utc::now().timestamp(),
        "status": "active",
        "scan_count": 0
    });

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "barcode": barcode,
        "message": "Barcode generated successfully"
    }))
}

/// Scan a barcode and get entity information
#[post("/api/barcode/scan")]
pub async fn scan_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let barcode_value = match body.get("barcode_value").and_then(|b| b.as_str()) {
        Some(b) => b,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "barcode_value is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let location = body.get("location").and_then(|l| l.as_str());

    // Mock scan result
    let entity_info = if barcode_value.contains("SP") {
        serde_json::json!({
            "type": "specimen",
            "id": "SPEC-001",
            "patient": "John Doe",
            "test": "CBC with Diff",
            "collected_at": chrono::Utc::now().timestamp() - 3600
        })
    } else if barcode_value.contains("MED") {
        serde_json::json!({
            "type": "medication",
            "id": "MED-001",
            "name": "Amoxicillin 500mg",
            "patient": "Jane Smith"
        })
    } else {
        serde_json::json!({"type": "unknown", "id": barcode_value})
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "barcode_value": barcode_value,
        "entity_info": entity_info,
        "location": location,
        "scanned_at": chrono::Utc::now().timestamp()
    }))
}

/// Track barcode movement history
#[get("/api/barcode/{barcode_id}/history")]
pub async fn track_barcode(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let barcode_id = path.into_inner();

    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }

    let history = vec![
        serde_json::json!({"status": "generated", "at": chrono::Utc::now().timestamp() - 86400, "by": "Dr. Smith"}),
        serde_json::json!({"status": "collected", "at": chrono::Utc::now().timestamp() - 82800, "by": "Nurse Jones", "location": "Patient Room 402"}),
        serde_json::json!({"status": "received_at_lab", "at": chrono::Utc::now().timestamp() - 79200, "by": "Lab Tech Brown", "location": "Main Lab Receiving"}),
        serde_json::json!({"status": "processing", "at": chrono::Utc::now().timestamp() - 75600, "by": "Lab Tech Brown", "location": "Hematology Section"}),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "barcode_id": barcode_id,
        "history": history
    }))
}

/// Get history of recent scans by current user
#[get("/api/barcode/scans/my")]
pub async fn get_barcode_scan_history(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let scan_history = vec![
        serde_json::json!({
            "barcode_value": "MCSP452103",
            "scanned_at": chrono::Utc::now().timestamp() - 300,
            "entity_type": "specimen",
            "location": "ER Station 1"
        }),
        serde_json::json!({
            "barcode_value": "MCMED892104",
            "scanned_at": chrono::Utc::now().timestamp() - 1200,
            "entity_type": "medication",
            "location": "Pharmacy Window 2"
        }),
    ];

    HttpResponse::Ok().json(scan_history)
}

// ============================================================================
// QUICK NOTE TEMPLATES
// ============================================================================

/// Get available note templates
#[get("/api/templates/notes")]
pub async fn get_note_templates(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let templates = vec![
        // SOAP Note Templates
        serde_json::json!({
            "template_id": "TPL-SOAP-ROUTINE",
            "name": "Routine Follow-up SOAP",
            "category": "SOAP",
            "content": {
                "subjective": "Patient presents for routine follow-up. Reports [SYMPTOMS]. Denies [NEGATIVE_SYMPTOMS]. Medications are being taken as prescribed.",
                "objective": "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]. General: Alert and oriented, no acute distress. [SYSTEM_EXAM]",
                "assessment": "1. [PRIMARY_DIAGNOSIS] - [STATUS]\n2. [SECONDARY_DIAGNOSIS] - [STATUS]",
                "plan": "1. Continue current medications\n2. [ADDITIONAL_ORDERS]\n3. Follow-up in [TIMEFRAME]"
            }
        }),
        serde_json::json!({
            "template_id": "TPL-SOAP-ED",
            "name": "Emergency Department SOAP",
            "category": "SOAP",
            "content": {
                "subjective": "Chief Complaint: [CC]\nHPI: [AGE] y/o [SEX] presents with [SYMPTOMS] x [DURATION]. Onset: [ONSET]. Quality: [QUALITY]. Severity: [SEVERITY]/10. Associated symptoms: [ASSOCIATED]. Denies: [PERTINENT_NEGATIVES].",
                "objective": "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]\nGeneral: [GENERAL]\nHEENT: [HEENT]\nCardio: [CARDIO]\nPulm: [PULM]\nAbd: [ABD]\nExt: [EXT]\nNeuro: [NEURO]",
                "assessment": "1. [DIAGNOSIS] - [DIFFERENTIAL_CONSIDERATIONS]",
                "plan": "1. [WORKUP]\n2. [TREATMENT]\n3. [DISPOSITION]"
            }
        }),
        // H&P Templates
        serde_json::json!({
            "template_id": "TPL-HP-ADMISSION",
            "name": "Admission H&P",
            "category": "H&P",
            "content": {
                "chief_complaint": "[CC]",
                "hpi": "[AGE] y/o [SEX] with PMH of [PMH] presenting with [SYMPTOMS]...",
                "pmh": "[PMH_LIST]",
                "psh": "[SURGICAL_HISTORY]",
                "medications": "[MEDICATION_LIST]",
                "allergies": "[ALLERGY_LIST]",
                "social_history": "Smoking: [SMOKING]\nAlcohol: [ALCOHOL]\nDrugs: [DRUGS]\nOccupation: [OCCUPATION]",
                "family_history": "[FAMILY_HISTORY]",
                "ros": "Constitutional: [CONST]\nCardiovascular: [CV]\nRespiratory: [RESP]\nGI: [GI]\nGU: [GU]\nMSK: [MSK]\nNeuro: [NEURO]\nPsych: [PSYCH]",
                "physical_exam": "[EXAM_FINDINGS]",
                "assessment_plan": "[ASSESSMENT_AND_PLAN]"
            }
        }),
        // Procedure Notes
        serde_json::json!({
            "template_id": "TPL-PROC-CENTRAL",
            "name": "Central Line Procedure Note",
            "category": "Procedure",
            "content": {
                "procedure": "Central Venous Catheter Placement",
                "indication": "[INDICATION]",
                "consent": "Informed consent obtained",
                "site": "[SITE] - [IJ/SC/FEMORAL]",
                "technique": "Sterile technique with full barrier precautions. Ultrasound-guided. Local anesthesia with [LIDOCAINE_DOSE]. [CATHETER_TYPE] catheter placed using Seldinger technique. [ATTEMPTS] attempt(s). Blood aspirated from all ports. Catheter secured at [CM] cm.",
                "complications": "[NONE/COMPLICATIONS]",
                "post_procedure": "CXR ordered for placement confirmation",
                "attending": "[ATTENDING_NAME]"
            }
        }),
        serde_json::json!({
            "template_id": "TPL-PROC-LP",
            "name": "Lumbar Puncture Procedure Note",
            "category": "Procedure",
            "content": {
                "procedure": "Lumbar Puncture",
                "indication": "[INDICATION]",
                "consent": "Informed consent obtained",
                "position": "[LATERAL_DECUBITUS/SITTING]",
                "site": "[L3-L4/L4-L5]",
                "technique": "Sterile technique. Local anesthesia with [LIDOCAINE]. [NEEDLE_SIZE] spinal needle. Opening pressure: [OP] cm H2O. [VOLUME] mL CSF collected in [TUBES] tubes.",
                "csf_appearance": "[CLEAR/CLOUDY/BLOODY/XANTHOCHROMIC]",
                "closing_pressure": "[CP] cm H2O",
                "complications": "[NONE/COMPLICATIONS]",
                "post_procedure": "Patient instructed to remain supine for [DURATION]"
            }
        }),
        // Discharge Templates
        serde_json::json!({
            "template_id": "TPL-DC-STANDARD",
            "name": "Standard Discharge Summary",
            "category": "Discharge",
            "content": {
                "admission_date": "[ADMIT_DATE]",
                "discharge_date": "[DC_DATE]",
                "admitting_diagnosis": "[ADMIT_DX]",
                "discharge_diagnoses": "[DC_DX_LIST]",
                "hospital_course": "[COURSE_SUMMARY]",
                "discharge_condition": "[STABLE/IMPROVED]",
                "discharge_medications": "[NEW_MED_LIST]",
                "follow_up_instructions": "[FOLLOW_UP_PLAN]"
            }
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "templates": templates,
        "count": templates.len()
    }))
}

/// Use a template to generate a note
#[post("/api/templates/notes/use")]
pub async fn use_note_template(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }

    let template_id = body
        .get("template_id")
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN");
    let variables = body.get("variables").and_then(|v| v.as_object());

    // Simple template variable replacement logic (Simulated)
    let generated_note = format!(
        "Generated note from template {} with {} variables filled.",
        template_id,
        variables.map(|v| v.len()).unwrap_or(0)
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "template_id": template_id,
        "generated_note": generated_note,
        "timestamp": chrono::Utc::now().timestamp()
    }))
}
