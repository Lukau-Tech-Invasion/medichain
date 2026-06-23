use super::*;

// ============================================================================
// PHASE 25: AI SYMPTOM CHECKER
// ============================================================================

/// Start symptom check session request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct StartSymptomCheckRequest {
    pub primary_symptom: String,
    pub age: Option<i32>,
    pub gender: Option<String>,
    pub pregnant: Option<bool>,
}

/// Start a symptom check session
#[post("/api/symptoms/start")]
pub async fn start_symptom_check(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<StartSymptomCheckRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    // Generate initial follow-up questions based on primary symptom
    let follow_up_questions = generate_symptom_questions(&req.primary_symptom);

    let initial_message = crate::clinical::SymptomMessage {
        role: crate::clinical::MessageRole::Patient,
        content: format!("I'm experiencing: {}", req.primary_symptom),
        timestamp: chrono::Utc::now().timestamp(),
        extracted_symptoms: None,
    };

    let session = crate::clinical::SymptomCheckSession {
        session_id: format!("SYM-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id.clone(),
        started_at: chrono::Utc::now().timestamp(),
        completed_at: None,
        initial_symptoms: vec![req.primary_symptom.clone()],
        conversation: vec![initial_message],
        assessment: None,
        triage_recommendation: None,
        status: crate::clinical::SymptomCheckStatus::InProgress,
    };

    let session_id = session.session_id.clone();
    {
        // Persist via repository (was: in-memory data.symptom_sessions HashMap)
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: session_id.clone(),
            owner_id: session.patient_id.clone(),
            data: serde_json::to_value(&session).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.symptom_sessions.create(entity).await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "questions": follow_up_questions,
        "message": "Symptom check started. Please answer the following questions."
    }))
}

/// Generate follow-up questions based on symptom
fn generate_symptom_questions(symptom: &str) -> Vec<serde_json::Value> {
    let symptom_lower = symptom.to_lowercase();

    let mut questions = vec![
        serde_json::json!({
            "id": "severity",
            "question": "On a scale of 1-10, how severe is this symptom?",
            "type": "scale",
            "min": 1,
            "max": 10
        }),
        serde_json::json!({
            "id": "duration",
            "question": "How long have you had this symptom?",
            "type": "choice",
            "options": ["Less than 24 hours", "1-3 days", "4-7 days", "1-2 weeks", "More than 2 weeks"]
        }),
    ];

    // Add symptom-specific questions
    if symptom_lower.contains("chest") || symptom_lower.contains("heart") {
        questions.push(serde_json::json!({
            "id": "chest_radiation",
            "question": "Does the pain radiate to your arm, jaw, or back?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "shortness_breath",
            "question": "Are you experiencing shortness of breath?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("head") || symptom_lower.contains("migraine") {
        questions.push(serde_json::json!({
            "id": "vision_changes",
            "question": "Are you experiencing any changes in your vision?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "nausea",
            "question": "Are you feeling nauseous?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("stomach") || symptom_lower.contains("abdominal") {
        questions.push(serde_json::json!({
            "id": "fever",
            "question": "Do you have a fever?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "vomiting",
            "question": "Are you vomiting?",
            "type": "boolean"
        }));
    }

    questions.push(serde_json::json!({
        "id": "medications",
        "question": "Have you taken any medications for this symptom?",
        "type": "text"
    }));

    questions
}

/// Submit symptom answers request
#[derive(Debug, Deserialize)]
pub struct SubmitSymptomAnswersRequest {
    pub answers: std::collections::HashMap<String, serde_json::Value>,
    pub additional_symptoms: Option<Vec<String>>,
}

/// Submit answers to symptom questions
#[post("/api/symptoms/{session_id}/answers")]
pub async fn submit_symptom_answers(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<SubmitSymptomAnswersRequest>,
) -> impl Responder {
    let session_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    // Fetch the session from the repository (was: in-memory data.symptom_sessions)
    let stored = data
        .repositories
        .symptom_sessions
        .get_by_id(&session_id)
        .await
        .ok()
        .flatten();

    let mut session: crate::clinical::SymptomCheckSession = match stored {
        Some(rec) => match serde_json::from_value(rec.data) {
            Ok(s) => s,
            Err(_) => {
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Corrupt session record".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                })
            }
        },
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    if session.patient_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Session does not belong to you".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Store answers as a conversation message
    let answer_content = req
        .answers
        .iter()
        .map(|(k, v)| format!("{}: {}", k, v))
        .collect::<Vec<_>>()
        .join(", ");

    session.conversation.push(crate::clinical::SymptomMessage {
        role: crate::clinical::MessageRole::Patient,
        content: answer_content,
        timestamp: chrono::Utc::now().timestamp(),
        extracted_symptoms: None,
    });

    // Add additional symptoms
    if let Some(additional) = &req.additional_symptoms {
        for symptom in additional {
            session.initial_symptoms.push(symptom.clone());
        }
    }

    // Calculate triage result based on answers
    let triage_result = calculate_triage_result(&req.answers, &session.initial_symptoms);
    session.triage_recommendation = Some(triage_result.clone());
    session.completed_at = Some(chrono::Utc::now().timestamp());
    session.status = crate::clinical::SymptomCheckStatus::Completed;

    // Generate assessment
    session.assessment = Some(crate::clinical::SymptomAssessment {
        possible_conditions: vec![crate::clinical::PossibleCondition {
            condition_name: "General symptoms requiring evaluation".to_string(),
            icd10_code: None,
            probability: 0.7,
            description: "Based on reported symptoms, a medical evaluation is recommended."
                .to_string(),
            urgency: crate::clinical::UrgencyLevel::Routine,
            common_causes: vec!["Various".to_string()],
        }],
        red_flags: Vec::new(),
        recommendations: vec!["Consult with a healthcare provider".to_string()],
        questions_for_provider: vec!["Describe symptom onset and progression".to_string()],
        self_care: vec!["Rest and stay hydrated".to_string()],
        confidence: 0.6,
        disclaimer: "This is not a medical diagnosis. Please consult a healthcare professional."
            .to_string(),
    });

    // Save updated session
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: session_id.clone(),
            owner_id: session.patient_id.clone(),
            data: serde_json::to_value(&session).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.symptom_sessions.create(entity).await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session": session
    }))
}

/// Helper: Calculate triage result based on answers
fn calculate_triage_result(
    answers: &std::collections::HashMap<String, serde_json::Value>,
    symptoms: &[String],
) -> crate::clinical::TriageRecommendation {
    let mut level = crate::clinical::TriageLevel::ScheduledAppointment;
    let mut explanation = "Monitor symptoms and report any changes to your doctor.".to_string();
    let mut timeframe = "Within 72 hours".to_string();
    let mut care_options = vec![crate::clinical::CareOption {
        option_type: "Follow-up".to_string(),
        description: "Schedule a routine follow-up appointment.".to_string(),
        available: true,
        estimated_wait: Some("72 hours".to_string()),
        cost_estimate: None,
    }];

    // Check for high severity
    if let Some(severity) = answers.get("severity").and_then(|v| v.as_i64()) {
        if severity >= 8 {
            level = crate::clinical::TriageLevel::UrgentCare;
            explanation =
                "Symptoms are high severity and need prompt medical attention.".to_string();
            timeframe = "Within 4 hours".to_string();
            care_options = vec![crate::clinical::CareOption {
                option_type: "Urgent care".to_string(),
                description: "Seek same-day urgent evaluation.".to_string(),
                available: true,
                estimated_wait: Some("4 hours".to_string()),
                cost_estimate: None,
            }];
        } else if severity >= 5 {
            level = crate::clinical::TriageLevel::SameDayAppointment;
            explanation = "Symptoms are moderate and should be reviewed soon.".to_string();
            timeframe = "Within 24 hours".to_string();
            care_options = vec![crate::clinical::CareOption {
                option_type: "Same-day appointment".to_string(),
                description: "Consult a doctor soon.".to_string(),
                available: true,
                estimated_wait: Some("24 hours".to_string()),
                cost_estimate: None,
            }];
        }
    }

    // Check for chest pain or shortness of breath
    let sym_lower: Vec<String> = symptoms.iter().map(|s| s.to_lowercase()).collect();
    if sym_lower
        .iter()
        .any(|s| s.contains("chest") || s.contains("heart"))
    {
        if answers.get("shortness_breath").and_then(|v| v.as_bool()) == Some(true) {
            level = crate::clinical::TriageLevel::EmergencyRoom;
            explanation =
                "Chest or heart symptoms with shortness of breath need emergency evaluation."
                    .to_string();
            timeframe = "Immediately".to_string();
            care_options = vec![crate::clinical::CareOption {
                option_type: "Emergency services".to_string(),
                description: "Call emergency services immediately. Do not drive yourself."
                    .to_string(),
                available: true,
                estimated_wait: Some("Immediate".to_string()),
                cost_estimate: None,
            }];
        }
    }

    crate::clinical::TriageRecommendation {
        level,
        explanation,
        timeframe,
        care_options,
    }
}

/// Get symptom session
#[get("/api/symptoms/{session_id}")]
pub async fn get_symptom_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let session_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let stored = data
        .repositories
        .symptom_sessions
        .get_by_id(&session_id)
        .await
        .ok()
        .flatten();

    let session: crate::clinical::SymptomCheckSession = match stored {
        Some(rec) => match serde_json::from_value(rec.data) {
            Ok(s) => s,
            Err(_) => {
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Corrupt session record".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                })
            }
        },
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    if session.patient_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session": session
    }))
}

/// Get symptom checker history
#[get("/api/symptoms/history/{patient_id}")]
pub async fn get_symptom_checker_history(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    // Auth check
    if current_user_id != patient_id && !current_user_id.starts_with("0xPROV") {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Repository list_all() (was: data.symptom_sessions HashMap)
    let all_records = data
        .repositories
        .symptom_sessions
        .list_all()
        .await
        .unwrap_or_default();
    let history: Vec<crate::clinical::SymptomCheckSession> = all_records
        .into_iter()
        .filter_map(|rec| {
            let s: crate::clinical::SymptomCheckSession = serde_json::from_value(rec.data).ok()?;
            if s.patient_id == patient_id {
                Some(s)
            } else {
                None
            }
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "sessions": history,
        "count": history.len()
    }))
}

/// Symptom analysis request for direct symptom-to-condition mapping
#[derive(Debug, Deserialize)]
pub struct AnalyzeSymptomsRequest {
    pub symptoms: Vec<String>,
    pub patient_age: Option<i32>,
    pub patient_gender: Option<String>,
    pub existing_conditions: Option<Vec<String>>,
    pub current_medications: Option<Vec<String>>,
}

/// Possible condition from symptom analysis
#[derive(Debug, Clone, serde::Serialize)]
pub struct PossibleConditionResult {
    pub condition_name: String,
    pub probability: f32,
    pub severity: String,
    pub description: String,
    pub icd10_code: Option<String>,
}

/// Direct symptom analysis endpoint - maps symptoms to possible conditions
#[post("/api/symptoms/analyze")]
pub async fn analyze_symptoms(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<AnalyzeSymptomsRequest>,
) -> impl Responder {
    // Validate user is authenticated
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    let symptoms = &req.symptoms;

    if symptoms.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "At least one symptom is required".to_string(),
            code: "INVALID_INPUT".to_string(),
        });
    }

    // Extract patient context for enhanced analysis
    let patient_age = req.patient_age;
    let patient_gender = req.patient_gender.as_deref();
    let existing_conditions = req.existing_conditions.as_ref();
    let current_medications = req.current_medications.as_ref();

    // Analyze symptoms with patient context
    let (possible_conditions, mut triage_level, red_flags) = analyze_symptom_combination(symptoms);

    // Age-specific risk adjustments
    let mut age_considerations = Vec::new();
    if let Some(age) = patient_age {
        if age >= 65 {
            age_considerations
                .push("Patient is 65+ years old - increased monitoring recommended".to_string());
            // Elevate severity for cardiac/respiratory symptoms in elderly
            if symptoms
                .iter()
                .any(|s| s.to_lowercase().contains("chest") || s.to_lowercase().contains("breath"))
                && triage_level == "medium"
            {
                triage_level = "high".to_string();
            }
        } else if age < 12 {
            age_considerations
                .push("Pediatric patient - dosing and symptoms may differ from adults".to_string());
        } else if age < 2 {
            age_considerations
                .push("Infant patient - lower threshold for emergency evaluation".to_string());
            if triage_level == "low" {
                triage_level = "medium".to_string();
            }
        }
    }

    // Gender-specific considerations
    let mut gender_considerations = Vec::new();
    if let Some(gender) = patient_gender {
        let g = gender.to_lowercase();
        if g == "female" || g == "f" {
            if symptoms
                .iter()
                .any(|s| s.to_lowercase().contains("chest pain"))
            {
                gender_considerations
                    .push("Note: Women may experience atypical heart attack symptoms".to_string());
            }
            if symptoms
                .iter()
                .any(|s| s.to_lowercase().contains("abdominal"))
            {
                gender_considerations
                    .push("Consider gynecological causes for abdominal symptoms".to_string());
            }
        }
    }

    // Check for existing condition interactions
    let mut condition_interactions = Vec::new();
    if let Some(conditions) = existing_conditions {
        for condition in conditions {
            let c = condition.to_lowercase();
            if c.contains("diabetes") {
                condition_interactions
                    .push("Diabetes may mask or alter typical symptom presentations".to_string());
            } else if c.contains("asthma") || c.contains("copd") {
                if symptoms.iter().any(|s| s.to_lowercase().contains("cough")) {
                    condition_interactions.push(
                        "Coughing in patients with respiratory conditions requires careful monitoring"
                            .to_string(),
                    );
                }
            }
        }
    }

    // Medication interactions
    let mut medication_notes = Vec::new();
    if let Some(meds) = current_medications {
        for med in meds {
            let m = med.to_lowercase();
            if m.contains("aspirin") || m.contains("warfarin") || m.contains("anticoagulant") {
                if symptoms
                    .iter()
                    .any(|s| s.to_lowercase().contains("bruising"))
                {
                    medication_notes.push(
                        "Bruising while on blood thinners should be evaluated by a doctor"
                            .to_string(),
                    );
                }
            }
        }
    }

    let (recommendation, specific_advice, next_steps, self_care) =
        generate_triage_recommendations(&triage_level, symptoms);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "assessment": {
            "possible_conditions": possible_conditions,
            "triage_level": triage_level,
            "red_flags": red_flags,
            "recommendation": recommendation,
            "specific_advice": specific_advice,
            "next_steps": next_steps,
            "self_care": self_care,
            "context_notes": {
                "age_considerations": age_considerations,
                "gender_considerations": gender_considerations,
                "condition_interactions": condition_interactions,
                "medication_notes": medication_notes
            }
        },
        "disclaimer": "This analysis is for informational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment."
    }))
}

/// Mock AI: Analyze symptom combination and return possible conditions
fn analyze_symptom_combination(
    symptoms: &[String],
) -> (Vec<PossibleConditionResult>, String, Vec<String>) {
    let sym_lower: Vec<String> = symptoms.iter().map(|s| s.to_lowercase()).collect();
    let mut results = Vec::new();
    let mut triage = "low".to_string();
    let mut red_flags = Vec::new();

    // Chest pain + Shortness of breath = Emergency
    if sym_lower.iter().any(|s| s.contains("chest pain")) {
        if sym_lower.iter().any(|s| s.contains("shortness of breath")) {
            triage = "emergency".to_string();
            red_flags.push("Chest pain combined with difficulty breathing".to_string());
            results.push(PossibleConditionResult {
                condition_name: "Myocardial Infarction (Heart Attack)".to_string(),
                probability: 0.4,
                severity: "Critical".to_string(),
                description: "Interruption of blood flow to the heart muscle.".to_string(),
                icd10_code: Some("I21.9".to_string()),
            });
        }
        results.push(PossibleConditionResult {
            condition_name: "Angina".to_string(),
            probability: 0.3,
            severity: "High".to_string(),
            description: "Chest pain caused by reduced blood flow to the heart.".to_string(),
            icd10_code: Some("I20.9".to_string()),
        });
    }

    // Fever + Cough + Shortness of breath
    if sym_lower.iter().any(|s| s.contains("fever"))
        && sym_lower.iter().any(|s| s.contains("cough"))
    {
        if sym_lower.iter().any(|s| s.contains("shortness of breath")) {
            triage = "high".to_string();
            results.push(PossibleConditionResult {
                condition_name: "Pneumonia".to_string(),
                probability: 0.5,
                severity: "High".to_string(),
                description: "Infection that inflames air sacs in one or both lungs.".to_string(),
                icd10_code: Some("J18.9".to_string()),
            });
        } else {
            triage = "medium".to_string();
            results.push(PossibleConditionResult {
                condition_name: "Influenza (Flu)".to_string(),
                probability: 0.6,
                severity: "Medium".to_string(),
                description:
                    "Common viral infection that can be deadly, especially in high-risk groups."
                        .to_string(),
                icd10_code: Some("J11.1".to_string()),
            });
            results.push(PossibleConditionResult {
                condition_name: "Common Cold".to_string(),
                probability: 0.4,
                severity: "Low".to_string(),
                description: "A viral infection of your nose and throat.".to_string(),
                icd10_code: Some("J00".to_string()),
            });
        }
    }

    // Headache + Nausea
    if sym_lower.iter().any(|s| s.contains("headache")) {
        if sym_lower.iter().any(|s| s.contains("nausea")) {
            results.push(PossibleConditionResult {
                condition_name: "Migraine".to_string(),
                probability: 0.7,
                severity: "Medium".to_string(),
                description: "A headache of varying intensity, often accompanied by nausea and sensitivity to light and sound."
                    .to_string(),
                icd10_code: Some("G43.9".to_string()),
            });
        }
        results.push(PossibleConditionResult {
            condition_name: "Tension Headache".to_string(),
            probability: 0.5,
            severity: "Low".to_string(),
            description: "A mild to moderate pain that's often described as feeling like a tight band around the head."
                .to_string(),
            icd10_code: Some("G44.2".to_string()),
        });
    }

    // Default if no specific matches
    if results.is_empty() {
        results.push(PossibleConditionResult {
            condition_name: "Symptomatic evaluation needed".to_string(),
            probability: 1.0,
            severity: "Unknown".to_string(),
            description:
                "Your symptoms require a more detailed evaluation by a medical professional."
                    .to_string(),
            icd10_code: None,
        });
    }

    // Final sorting
    results.sort_by(|a, b| b.probability.partial_cmp(&a.probability).unwrap());

    (results, triage, red_flags)
}

/// Mock AI: Generate triage recommendations based on level
fn generate_triage_recommendations(
    triage_level: &str,
    _symptoms: &[String],
) -> (String, Vec<String>, Vec<String>, Vec<String>) {
    match triage_level {
        "emergency" => (
            "EMERGENCY CARE REQUIRED".to_string(),
            vec!["You are experiencing symptoms that may indicate a life-threatening condition."
                .to_string()],
            vec!["Call 911 or your local emergency number immediately.".to_string(), "Do not attempt to drive yourself to the hospital.".to_string()],
            vec!["Sit or lie down in a comfortable position while waiting for help.".to_string()],
        ),
        "high" => (
            "Urgent Medical Evaluation Recommended".to_string(),
            vec!["Your symptoms require prompt evaluation by a healthcare provider.".to_string()],
            vec!["Contact your doctor immediately for an urgent appointment.".to_string(), "If your doctor is unavailable, visit an urgent care center or emergency room.".to_string()],
            vec!["Monitor for any worsening of symptoms.".to_string()],
        ),
        "medium" => (
            "Schedule an Appointment".to_string(),
            vec!["You should be evaluated by a healthcare professional within the next 24-48 hours."
                .to_string()],
            vec!["Schedule an appointment with your primary care physician.".to_string(), "Use our booking tool to find the next available slot.".to_string()],
            vec!["Rest, stay hydrated, and use over-the-counter medications as directed for symptom relief.".to_string()],
        ),
        _ => (
            "Home Care and Monitoring".to_string(),
            vec!["Your symptoms currently appear to be low-risk.".to_string()],
            vec!["Monitor your symptoms over the next few days.".to_string(), "Book a routine appointment if symptoms persist or worsen.".to_string()],
            vec!["Get plenty of rest.".to_string(), "Drink fluids.".to_string(), "Monitor your temperature.".to_string()],
        ),
    }
}
