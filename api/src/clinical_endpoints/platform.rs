//! `clinical_endpoints::platform` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 31: ANALYTICS DASHBOARD
// ============================================================================

/// Analytics query request
#[derive(Debug, Deserialize)]
pub struct AnalyticsQueryRequest {
    pub start_date: String,
    pub end_date: String,
    pub include_financial: Option<bool>,
}

/// Get dashboard metrics
#[get("/api/analytics/dashboard")]
pub async fn get_dashboard_metrics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    query: web::Query<AnalyticsQueryRequest>,
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

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can access analytics".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();

    // Calculate metrics from stored data
    // Patient count via repository (was: in-memory data.patients HashMap)
    let patient_count = data.repositories.patients.count().await.unwrap_or(0);
    let appointments_page = data
        .repositories
        .appointments
        .list_all(crate::repositories::traits::Pagination::new(10_000, 0))
        .await
        .unwrap_or_else(|_| {
            crate::repositories::traits::PaginatedResult::new(
                Vec::new(),
                0,
                &crate::repositories::traits::Pagination::new(10_000, 0),
            )
        });
    let claims = data
        .repositories
        .insurance_claims
        .list_all()
        .await
        .unwrap_or_default();
    let cds_alerts_page = data
        .repositories
        .cds_alerts
        .list_all(crate::repositories::traits::Pagination::new(10_000, 0))
        .await
        .unwrap_or_else(|_| {
            crate::repositories::traits::PaginatedResult::new(
                Vec::new(),
                0,
                &crate::repositories::traits::Pagination::new(10_000, 0),
            )
        });

    let total_patients = patient_count;
    let total_appointments = appointments_page.total;
    let completed_appointments = appointments_page
        .items
        .iter()
        .filter(|a| a.status.eq_ignore_ascii_case("completed"))
        .count() as u64;
    let cancelled_appointments = appointments_page
        .items
        .iter()
        .filter(|a| a.status.eq_ignore_ascii_case("cancelled"))
        .count() as u64;
    let telehealth_count = appointments_page
        .items
        .iter()
        .filter(|a| a.visit_type.as_deref() == Some("telehealth"))
        .count() as u64;

    let total_claims = claims.len() as u64;
    let paid_claims = claims
        .iter()
        .filter(|c| c.data.get("status").and_then(|v| v.as_str()) == Some("Paid"))
        .count() as u64;
    let denied_claims = claims
        .iter()
        .filter(|c| c.data.get("status").and_then(|v| v.as_str()) == Some("Denied"))
        .count() as u64;

    let cds_alert_count = cds_alerts_page.total;
    let cds_accepted = cds_alerts_page
        .items
        .iter()
        .filter(|a| a.action_taken.as_deref() == Some("Accepted"))
        .count() as u64;

    let telehealth_pct = if total_appointments > 0 {
        (telehealth_count as f32 / total_appointments as f32) * 100.0
    } else {
        0.0
    };

    let dashboard = crate::clinical::DashboardMetrics {
        generated_at: now,
        period: crate::clinical::AnalyticsPeriod {
            start_date: query.start_date.clone(),
            end_date: query.end_date.clone(),
            comparison_start: None,
            comparison_end: None,
        },
        patient_metrics: crate::clinical::PatientMetrics {
            total_patients,
            new_patients: 5,
            active_patients: total_patients,
            patients_by_age_group: vec![
                crate::clinical::AgeGroupCount {
                    age_group: "0-17".to_string(),
                    count: 2,
                },
                crate::clinical::AgeGroupCount {
                    age_group: "18-34".to_string(),
                    count: 3,
                },
                crate::clinical::AgeGroupCount {
                    age_group: "35-54".to_string(),
                    count: 4,
                },
                crate::clinical::AgeGroupCount {
                    age_group: "55-74".to_string(),
                    count: 2,
                },
                crate::clinical::AgeGroupCount {
                    age_group: "75+".to_string(),
                    count: 1,
                },
            ],
            patients_by_gender: vec![
                crate::clinical::GenderCount {
                    gender: "Male".to_string(),
                    count: 6,
                },
                crate::clinical::GenderCount {
                    gender: "Female".to_string(),
                    count: 6,
                },
            ],
            top_conditions: vec![
                crate::clinical::ConditionCount {
                    condition: "Hypertension".to_string(),
                    icd10_code: "I10".to_string(),
                    count: 4,
                },
                crate::clinical::ConditionCount {
                    condition: "Type 2 Diabetes".to_string(),
                    icd10_code: "E11".to_string(),
                    count: 3,
                },
            ],
        },
        appointment_metrics: crate::clinical::AppointmentMetrics {
            total_appointments,
            completed_appointments,
            cancelled_appointments,
            no_show_rate: 5.0,
            average_wait_time_minutes: 12.5,
            appointments_by_type: vec![
                crate::clinical::AppointmentTypeCount {
                    appointment_type: "General Consultation".to_string(),
                    count: total_appointments / 2,
                },
                crate::clinical::AppointmentTypeCount {
                    appointment_type: "Follow-up".to_string(),
                    count: total_appointments / 4,
                },
            ],
            appointments_by_provider: vec![crate::clinical::ProviderAppointmentCount {
                provider_id: "PROVIDER-SAMPLE-001".to_string(),
                provider_name: "Dr. Sample Provider".to_string(),
                count: total_appointments / 2,
            }],
            telehealth_percentage: telehealth_pct,
        },
        clinical_metrics: crate::clinical::ClinicalMetrics {
            total_encounters: total_appointments,
            prescriptions_written: 15,
            lab_orders: 10,
            imaging_orders: 5,
            referrals_made: 3,
            procedures_performed: 8,
            immunizations_given: 12,
            cds_alerts_generated: cds_alert_count,
            cds_alerts_accepted: cds_accepted,
        },
        financial_metrics: if query.include_financial.unwrap_or(false) {
            let total_charges: f64 = claims
                .iter()
                .filter_map(|c| c.data.get("total_charge").and_then(|v| v.as_f64()))
                .sum();
            let total_payments: f64 = claims
                .iter()
                .filter_map(|c| c.data.get("paid_amount").and_then(|v| v.as_f64()))
                .sum();
            Some(crate::clinical::FinancialMetrics {
                total_charges,
                total_payments,
                claims_submitted: total_claims,
                claims_paid: paid_claims,
                claims_denied: denied_claims,
                denial_rate: if total_claims > 0 {
                    (denied_claims as f32 / total_claims as f32) * 100.0
                } else {
                    0.0
                },
                average_days_to_payment: 28.5,
                ar_aging: crate::clinical::ARAgingBreakdown {
                    current: 5000.0,
                    days_30: 2500.0,
                    days_60: 1200.0,
                    days_90: 500.0,
                    over_90: 300.0,
                },
            })
        } else {
            None
        },
        quality_metrics: crate::clinical::QualityMetrics {
            preventive_care_compliance: 85.5,
            chronic_care_compliance: 78.0,
            medication_adherence_rate: 82.0,
            patient_satisfaction_score: 4.5,
            hedis_measures: vec![crate::clinical::HedisMeasure {
                measure_id: "BCS".to_string(),
                measure_name: "Breast Cancer Screening".to_string(),
                numerator: 45,
                denominator: 50,
                rate: 90.0,
                benchmark: 75.0,
                meets_benchmark: true,
            }],
        },
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "dashboard": dashboard
    }))
}

/// Get patient analytics
#[get("/api/analytics/patients")]
pub async fn get_patient_analytics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can access analytics".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Via repository (was: in-memory data.patients HashMap)
    let total = data.repositories.patients.count().await.unwrap_or(0) as usize;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total_patients": total,
        "new_patients_this_month": 3,
        "active_patients": total,
        "age_distribution": {
            "0-17": 2,
            "18-34": 3,
            "35-54": 4,
            "55-74": 2,
            "75+": 1
        },
        "gender_distribution": {
            "male": 6,
            "female": 6
        }
    }))
}

/// Get appointment analytics
#[get("/api/analytics/appointments")]
pub async fn get_appointment_analytics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can access analytics".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let appointments_page = data
        .repositories
        .appointments
        .list_all(crate::repositories::traits::Pagination::new(10_000, 0))
        .await
        .unwrap_or_else(|_| {
            crate::repositories::traits::PaginatedResult::new(
                Vec::new(),
                0,
                &crate::repositories::traits::Pagination::new(10_000, 0),
            )
        });
    let total = appointments_page.total as usize;
    let completed = appointments_page
        .items
        .iter()
        .filter(|a| a.status.eq_ignore_ascii_case("completed"))
        .count();
    let cancelled = appointments_page
        .items
        .iter()
        .filter(|a| a.status.eq_ignore_ascii_case("cancelled"))
        .count();
    let telehealth = appointments_page
        .items
        .iter()
        .filter(|a| a.visit_type.as_deref() == Some("telehealth"))
        .count();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total_appointments": total,
        "completed": completed,
        "cancelled": cancelled,
        "no_shows": 2,
        "telehealth_appointments": telehealth,
        "telehealth_percentage": if total > 0 { (telehealth as f32 / total as f32) * 100.0 } else { 0.0 },
        "average_wait_time_minutes": 12.5,
        "appointments_by_day": {
            "monday": 10,
            "tuesday": 12,
            "wednesday": 15,
            "thursday": 11,
            "friday": 8
        }
    }))
}

/// Get quality metrics
#[get("/api/analytics/quality")]
pub async fn get_quality_metrics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can access analytics".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "quality_metrics": {
            "preventive_care_compliance": 85.5,
            "chronic_care_compliance": 78.0,
            "medication_adherence_rate": 82.0,
            "patient_satisfaction_score": 4.5,
            "hedis_measures": [
                {
                    "measure_id": "BCS",
                    "measure_name": "Breast Cancer Screening",
                    "rate": 90.0,
                    "benchmark": 75.0,
                    "meets_benchmark": true
                },
                {
                    "measure_id": "COL",
                    "measure_name": "Colorectal Cancer Screening",
                    "rate": 72.0,
                    "benchmark": 65.0,
                    "meets_benchmark": true
                },
                {
                    "measure_id": "CDC",
                    "measure_name": "Comprehensive Diabetes Care",
                    "rate": 68.0,
                    "benchmark": 70.0,
                    "meets_benchmark": false
                }
            ]
        }
    }))
}

// ============================================================================
// PHASE 32: MULTI-LANGUAGE SUPPORT
// ============================================================================

/// Set language preference request
#[derive(Debug, Deserialize)]
pub struct SetLanguagePreferenceRequest {
    pub preferred_language: String,
    pub secondary_language: Option<String>,
    pub needs_interpreter: bool,
    pub interpreter_language: Option<String>,
}

/// Translation request input
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct TranslateContentRequest {
    pub content: String,
    pub source_language: String,
    pub target_language: String,
    pub content_type: String,
    pub medical_context: bool,
}

/// Get supported languages
#[get("/api/languages")]
pub async fn get_supported_languages() -> impl Responder {
    let languages = vec![
        crate::clinical::SupportedLanguage {
            code: "en".to_string(),
            name: "English".to_string(),
            native_name: "English".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "ar".to_string(),
            name: "Arabic".to_string(),
            native_name: "العربية".to_string(),
            rtl: true,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "es".to_string(),
            name: "Spanish".to_string(),
            native_name: "Español".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "fr".to_string(),
            name: "French".to_string(),
            native_name: "Français".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "ur".to_string(),
            name: "Urdu".to_string(),
            native_name: "اردو".to_string(),
            rtl: true,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "hi".to_string(),
            name: "Hindi".to_string(),
            native_name: "हिन्दी".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: false,
        },
        crate::clinical::SupportedLanguage {
            code: "bn".to_string(),
            name: "Bengali".to_string(),
            native_name: "বাংলা".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: false,
        },
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "languages": languages,
        "count": languages.len()
    }))
}

/// Set user language preference
#[post("/api/languages/preference")]
pub async fn set_language_preference(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SetLanguagePreferenceRequest>,
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

    let now = chrono::Utc::now().timestamp();

    let reading_proficiency = match req.preferred_language.as_str() {
        "en" | "ar" => crate::clinical::LanguageProficiency::Native,
        _ => crate::clinical::LanguageProficiency::Fluent,
    };

    let preference = crate::clinical::LanguagePreference {
        user_id: current_user_id.clone(),
        preferred_language: req.preferred_language.clone(),
        secondary_language: req.secondary_language.clone(),
        reading_proficiency,
        needs_interpreter: req.needs_interpreter,
        interpreter_language: req.interpreter_language.clone(),
        updated_at: now,
    };

    // Persist via repository (was: in-memory data.language_preferences HashMap)
    let now_dt = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: current_user_id.clone(),
        owner_id: current_user_id.clone(),
        data: serde_json::to_value(&preference).unwrap_or_default(),
        created_at: now_dt,
        updated_at: now_dt,
    };
    let _ = data.repositories.language_preferences.create(entity).await;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "user_id": current_user_id,
        "preferred_language": req.preferred_language,
        "message": "Language preference updated"
    }))
}

/// Get user language preference
#[get("/api/languages/preference/{user_id}")]
pub async fn get_language_preference(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user_id = path.into_inner();

    let _current_user_id = match http_req.headers().get("X-User-Id") {
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
        .language_preferences
        .get_by_id(&user_id)
        .await
        .ok()
        .flatten();

    if let Some(rec) = stored {
        HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "preference": rec.data
        }))
    } else {
        // Return default English preference
        HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "preference": {
                "user_id": user_id,
                "preferred_language": "en",
                "secondary_language": null,
                "reading_proficiency": "Native",
                "needs_interpreter": false,
                "interpreter_language": null
            }
        }))
    }
}

/// Translate content
#[post("/api/languages/translate")]
pub async fn translate_content(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<TranslateContentRequest>,
) -> impl Responder {
    let _current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let request_id = format!("TR-{}", uuid::Uuid::new_v4());

    // Simulate translation (in production, this would call a translation service)
    let translated_content = match req.target_language.as_str() {
        "ar" => format!("[Arabic Translation of: {}]", req.content),
        "es" => format!("[Spanish Translation of: {}]", req.content),
        "fr" => format!("[French Translation of: {}]", req.content),
        "ur" => format!("[Urdu Translation of: {}]", req.content),
        "hi" => format!("[Hindi Translation of: {}]", req.content),
        "bn" => format!("[Bengali Translation of: {}]", req.content),
        "en" => req.content.clone(),
        _ => format!(
            "[Translation to {} of: {}]",
            req.target_language, req.content
        ),
    };

    let _content_type = match req.content_type.as_str() {
        "ui" => crate::clinical::TranslationContentType::UILabel,
        "instructions" => crate::clinical::TranslationContentType::PatientInstructions,
        "medication" => crate::clinical::TranslationContentType::MedicationDirections,
        "diagnosis" => crate::clinical::TranslationContentType::DiagnosisDescription,
        "consent" => crate::clinical::TranslationContentType::ConsentForm,
        "education" => crate::clinical::TranslationContentType::EducationalMaterial,
        "alert" => crate::clinical::TranslationContentType::Alert,
        _ => crate::clinical::TranslationContentType::Message,
    };

    let response = crate::clinical::TranslationResponse {
        request_id: request_id.clone(),
        translated_content,
        confidence_score: 0.95,
        human_reviewed: false,
        alternative_translations: vec![],
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "translation": response
    }))
}

// ============================================================================
// PHASE 33: OFFLINE MODE SYNC
// ============================================================================

/// Register device for offline sync
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct RegisterDeviceRequest {
    pub device_id: String,
    pub device_name: String,
    pub device_type: String,
    pub offline_categories: Vec<String>,
}

/// Sync request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct SyncRequest {
    pub device_id: String,
    pub last_sync_at: Option<i64>,
    pub pending_items: Vec<SyncItemInput>,
}

#[derive(Debug, Deserialize)]
pub struct SyncItemInput {
    pub entity_type: String,
    pub entity_id: String,
    pub operation: String,
    pub data: serde_json::Value,
    pub local_timestamp: i64,
}

/// Resolve conflict request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ResolveConflictRequest {
    pub resolution: String,
    pub merged_data: Option<serde_json::Value>,
}

/// Get sync status
#[get("/api/sync/status/{device_id}")]
pub async fn get_sync_status(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let device_id = path.into_inner();

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

    let now = chrono::Utc::now().timestamp();
    let pending_uploads = data
        .repositories
        .sync_queue_items
        .get_by_owner(&device_id)
        .await
        .unwrap_or_default()
        .iter()
        .filter(|r| r.data.get("status").and_then(|v| v.as_str()) == Some("Pending"))
        .count() as u32;

    let status = crate::clinical::SyncStatus {
        device_id: device_id.clone(),
        user_id: current_user_id,
        last_sync_at: now - 300, // 5 minutes ago
        sync_in_progress: false,
        pending_uploads,
        pending_downloads: 0,
        last_error: None,
        offline_since: None,
        data_freshness: crate::clinical::DataFreshness::Current,
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "status": status
    }))
}

/// Register device for offline sync
#[post("/api/sync/register")]
pub async fn register_sync_device(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<RegisterDeviceRequest>,
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

    let now = chrono::Utc::now().timestamp();

    // Parse offline categories
    let categories: Vec<crate::clinical::OfflineCategory> = req
        .offline_categories
        .iter()
        .filter_map(|c| match c.as_str() {
            "demographics" => Some(crate::clinical::OfflineCategory::Demographics),
            "allergies" => Some(crate::clinical::OfflineCategory::Allergies),
            "medications" => Some(crate::clinical::OfflineCategory::Medications),
            "conditions" => Some(crate::clinical::OfflineCategory::Conditions),
            "vital_signs" => Some(crate::clinical::OfflineCategory::VitalSigns),
            "lab_results" => Some(crate::clinical::OfflineCategory::LabResults),
            "immunizations" => Some(crate::clinical::OfflineCategory::Immunizations),
            "appointments" => Some(crate::clinical::OfflineCategory::Appointments),
            "care_team" => Some(crate::clinical::OfflineCategory::CareTeam),
            "emergency_contacts" => Some(crate::clinical::OfflineCategory::EmergencyContacts),
            _ => None,
        })
        .collect();

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "device_id": req.device_id,
        "user_id": current_user_id,
        "registered_at": now,
        "offline_categories": categories,
        "message": "Device registered for offline sync"
    }))
}

/// Perform sync
#[post("/api/sync")]
pub async fn perform_sync(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SyncRequest>,
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

    let now = chrono::Utc::now().timestamp();
    let mut processed = 0;
    let mut conflicts: Vec<crate::clinical::SyncConflict> = Vec::new();

    // Build the latest server-side version per (entity_type, entity_id) from prior
    // sync history — the basis for last-write-wins conflict detection.
    let mut latest: std::collections::HashMap<(String, String), (i64, serde_json::Value)> =
        std::collections::HashMap::new();
    if let Ok(existing) = data.repositories.sync_queue_items.list_all().await {
        for e in existing {
            if let Ok(prev) =
                serde_json::from_value::<crate::clinical::SyncQueueItem>(e.data.clone())
            {
                let key = (prev.entity_type.clone(), prev.entity_id.clone());
                let newer = latest
                    .get(&key)
                    .map(|(ts, _)| prev.created_at >= *ts)
                    .unwrap_or(true);
                if newer {
                    latest.insert(key, (prev.created_at, prev.data.clone()));
                }
            }
        }
    }

    // Process pending items from client (persist each via repository)
    for item in &req.pending_items {
        // Last-write-wins: if the server already holds a version of this entity that
        // is newer than the client's local copy, record a conflict and hold the change.
        if let Some((server_ts, server_data)) =
            latest.get(&(item.entity_type.clone(), item.entity_id.clone()))
        {
            if *server_ts > item.local_timestamp {
                let conflict_id = format!("CONF-{}", uuid::Uuid::new_v4());
                conflicts.push(crate::clinical::SyncConflict {
                    conflict_id: conflict_id.clone(),
                    entity_type: item.entity_type.clone(),
                    entity_id: item.entity_id.clone(),
                    local_data: item.data.clone(),
                    local_modified_at: item.local_timestamp,
                    server_data: server_data.clone(),
                    server_modified_at: *server_ts,
                    resolution: None,
                    detected_at: now,
                    resolved_at: None,
                    resolved_by: None,
                });
                let conflict_entity = crate::repositories::traits::SyncConflictEntity {
                    id: conflict_id,
                    sync_operation_id: None,
                    entity_type: item.entity_type.clone(),
                    entity_id: item.entity_id.clone(),
                    patient_id: None,
                    conflict_type: "concurrent_update".to_string(),
                    field_name: None,
                    local_value: Some(item.data.to_string()),
                    remote_value: Some(server_data.to_string()),
                    local_timestamp: chrono::DateTime::from_timestamp(item.local_timestamp, 0),
                    remote_timestamp: chrono::DateTime::from_timestamp(*server_ts, 0),
                    local_version: None,
                    remote_version: None,
                    status: Some("pending".to_string()),
                    resolution_strategy: None,
                    resolved_value: None,
                    resolved_by: None,
                    resolved_at: None,
                    resolution_notes: None,
                    created_at: Some(chrono::Utc::now()),
                };
                let _ = data
                    .repositories
                    .sync_conflicts
                    .create(conflict_entity)
                    .await;
                continue; // hold the client change until the conflict is resolved
            }
        }

        let queue_id = format!("SQ-{}", uuid::Uuid::new_v4());

        let operation = match item.operation.as_str() {
            "create" => crate::clinical::SyncOperation::Create,
            "update" => crate::clinical::SyncOperation::Update,
            "delete" => crate::clinical::SyncOperation::Delete,
            _ => crate::clinical::SyncOperation::Update,
        };

        let sync_item = crate::clinical::SyncQueueItem {
            queue_id: queue_id.clone(),
            device_id: req.device_id.clone(),
            user_id: current_user_id.clone(),
            entity_type: item.entity_type.clone(),
            entity_id: item.entity_id.clone(),
            operation,
            data: item.data.clone(),
            created_at: item.local_timestamp,
            priority: crate::clinical::SyncPriority::Normal,
            attempts: 1,
            last_attempt_at: Some(now),
            last_error: None,
            status: crate::clinical::SyncItemStatus::Completed,
        };

        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: queue_id.clone(),
            owner_id: req.device_id.clone(),
            data: serde_json::to_value(&sync_item).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.sync_queue_items.create(entity).await;
        latest.insert(
            (item.entity_type.clone(), item.entity_id.clone()),
            (item.local_timestamp, item.data.clone()),
        );
        processed += 1;
    }

    // Get changes from server since last sync (simulated)
    let server_changes: Vec<serde_json::Value> = vec![];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "sync_id": format!("SYNC-{}", uuid::Uuid::new_v4()),
        "synced_at": now,
        "uploaded": processed,
        "downloaded": server_changes.len(),
        "conflicts": conflicts,
        "server_changes": server_changes,
        "next_sync_token": format!("token_{}", now)
    }))
}

/// List pending sync conflicts (detected by the last-write-wins check in /api/sync).
#[get("/api/sync/conflicts")]
pub async fn get_sync_conflicts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }
    let conflicts = data
        .repositories
        .sync_conflicts
        .get_pending()
        .await
        .unwrap_or_default();
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": conflicts.len(),
        "conflicts": conflicts,
    }))
}

/// Resolve a sync conflict by keeping the local, server, or merged value.
#[post("/api/sync/conflicts/{conflict_id}/resolve")]
pub async fn resolve_sync_conflict(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<ResolveConflictRequest>,
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
    let conflict_id = path.into_inner();

    let conflict = match data
        .repositories
        .sync_conflicts
        .get_by_id(&conflict_id)
        .await
    {
        Ok(c) => c,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Conflict not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Pick the winning value based on the requested strategy.
    let (resolved_value, strategy) = match req.resolution.to_lowercase().as_str() {
        "uselocal" | "use_local" | "local" | "keep_local" => {
            (conflict.local_value.clone().unwrap_or_default(), "UseLocal")
        }
        "useserver" | "use_server" | "server" | "keep_server" => (
            conflict.remote_value.clone().unwrap_or_default(),
            "UseServer",
        ),
        "merge" => (
            req.merged_data
                .as_ref()
                .map(|v| v.to_string())
                .unwrap_or_default(),
            "Merge",
        ),
        other => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: format!(
                    "Unknown resolution '{}' (use UseLocal, UseServer, or Merge)",
                    other
                ),
                code: "INVALID_RESOLUTION".to_string(),
            })
        }
    };

    // When local/merged wins, write it back as the newest synced version so future
    // syncs treat it as the server's current copy.
    if strategy != "UseServer" {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&resolved_value) {
            let now = chrono::Utc::now();
            let queue_id = format!("SQ-{}", uuid::Uuid::new_v4());
            let sync_item = crate::clinical::SyncQueueItem {
                queue_id: queue_id.clone(),
                device_id: "conflict-resolution".to_string(),
                user_id: current_user_id.clone(),
                entity_type: conflict.entity_type.clone(),
                entity_id: conflict.entity_id.clone(),
                operation: crate::clinical::SyncOperation::Update,
                data: value,
                created_at: now.timestamp(),
                priority: crate::clinical::SyncPriority::Normal,
                attempts: 1,
                last_attempt_at: Some(now.timestamp()),
                last_error: None,
                status: crate::clinical::SyncItemStatus::Completed,
            };
            let entity = crate::repositories::traits::JsonRecordEntity {
                id: queue_id.clone(),
                owner_id: "conflict-resolution".to_string(),
                data: serde_json::to_value(&sync_item).unwrap_or_default(),
                created_at: now,
                updated_at: now,
            };
            let _ = data.repositories.sync_queue_items.create(entity).await;
        }
    }

    match data
        .repositories
        .sync_conflicts
        .resolve(
            &conflict_id,
            &resolved_value,
            &current_user_id,
            Some(strategy),
        )
        .await
    {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "conflict_id": conflict_id,
            "resolution": strategy,
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "RESOLVE_FAILED".to_string(),
        }),
    }
}

/// Get sync queue
#[get("/api/sync/queue/{device_id}")]
pub async fn get_sync_queue(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let device_id = path.into_inner();

    let _current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let device_queue: Vec<_> = data
        .repositories
        .sync_queue_items
        .get_by_owner(&device_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|r| r.data)
        .collect();

    let pending = device_queue
        .iter()
        .filter(|i| i.get("status").and_then(|v| v.as_str()) == Some("Pending"))
        .count();
    let failed = device_queue
        .iter()
        .filter(|i| i.get("status").and_then(|v| v.as_str()) == Some("Failed"))
        .count();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "device_id": device_id,
        "total_items": device_queue.len(),
        "pending": pending,
        "failed": failed,
        "items": device_queue
    }))
}

/// Download offline data
#[get("/api/sync/download/{patient_id}")]
pub async fn download_offline_data(
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

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    let is_own = current_user_id == patient_id;
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();

    // Get patient data for offline use via repository (was: in-memory data.patients HashMap)
    let patient = data
        .repositories
        .patients
        .get_by_id(&patient_id)
        .await
        .ok()
        .and_then(|e| crate::patient_entity_to_profile(&e, &data.encryption_key));

    let patient_meds: Vec<crate::clinical::MedicationReminder> = data
        .repositories
        .medication_reminders
        .get_by_patient(&patient_id)
        .await
        .map(|items| {
            items
                .into_iter()
                .map(crate::clinical::MedicationReminder::from)
                .collect()
        })
        .unwrap_or_default();

    let patient_appts: Vec<crate::clinical::Appointment> = data
        .repositories
        .appointments
        .get_by_patient(
            &patient_id,
            crate::repositories::traits::Pagination::new(1000, 0),
        )
        .await
        .map(|page| {
            page.items
                .into_iter()
                .map(crate::clinical::Appointment::from)
                .collect()
        })
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "downloaded_at": now,
        "expires_at": now + 86400 * 7, // 7 days
        "data": {
            "demographics": patient,
            "medications": patient_meds,
            "appointments": patient_appts,
            "allergies": [],
            "conditions": [],
            "vital_signs": []
        },
        "encrypted": false,
        "total_size_bytes": 50000
    }))
}

// ============================================================================
// List Endpoints for Frontend Pages
// ============================================================================

/// List all chain of custody records
#[get("/api/clinical/chain-of-custody")]
pub async fn list_chain_of_custody(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let items = data
        .repositories
        .chain_of_custody
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all lab QC records
#[get("/api/clinical/lab-qc")]
pub async fn list_lab_qc(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let items = data
        .repositories
        .lab_qc_records
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all critical value notifications
#[get("/api/clinical/critical-values")]
pub async fn list_critical_values(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let items = data
        .repositories
        .critical_values
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all radiology orders
#[get("/api/clinical/radiology/orders")]
pub async fn list_radiology_orders(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let order_items = data
        .repositories
        .radiology_orders
        .list_all()
        .await
        .unwrap_or_default();
    let report_items = data
        .repositories
        .radiology_reports
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "orders": {
            "total": order_items.len(),
            "items": order_items
        },
        "reports": {
            "total": report_items.len(),
            "items": report_items
        }
    }))
}

/// List all pathology reports
#[get("/api/clinical/pathology")]
pub async fn list_pathology(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let items = data
        .repositories
        .pathology_reports
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all immunization records
#[get("/api/clinical/immunizations")]
pub async fn list_immunizations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record_items: Vec<crate::clinical::ImmunizationRecord> = data
        .repositories
        .immunization_records
        .list_all()
        .await
        .map(|items| {
            items
                .into_iter()
                .map(crate::clinical::ImmunizationRecord::from)
                .collect()
        })
        .unwrap_or_default();
    let schedule_items = data
        .repositories
        .immunization_schedules
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "records": {
            "total": record_items.len(),
            "items": record_items
        },
        "schedules": {
            "total": schedule_items.len(),
            "items": schedule_items
        }
    }))
}

/// List all blood bank records
#[get("/api/clinical/blood-bank")]
pub async fn list_blood_bank(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let type_screen_items = data
        .repositories
        .blood_type_screens
        .list_all()
        .await
        .unwrap_or_default();
    let crossmatch_items = data
        .repositories
        .crossmatch_records
        .list_all()
        .await
        .unwrap_or_default();
    let transfusion_items = data
        .repositories
        .transfusion_records
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "type_screens": {
            "total": type_screen_items.len(),
            "items": type_screen_items
        },
        "crossmatches": {
            "total": crossmatch_items.len(),
            "items": crossmatch_items
        },
        "transfusions": {
            "total": transfusion_items.len(),
            "items": transfusion_items
        }
    }))
}

/// List all autopsy records
#[get("/api/clinical/autopsy")]
pub async fn list_autopsy(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let request_items: Vec<_> = data
        .repositories
        .autopsy_requests
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|r| r.data)
        .collect();
    let report_items: Vec<_> = data
        .repositories
        .autopsy_reports
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|r| r.data)
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "requests": {
            "total": request_items.len(),
            "items": request_items
        },
        "reports": {
            "total": report_items.len(),
            "items": report_items
        }
    }))
}

/// List all consultation notes
#[get("/api/clinical/consults")]
pub async fn list_consults(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let items = data
        .repositories
        .consultation_notes
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all CDS alerts
#[get("/api/clinical/cds-alerts")]
pub async fn list_cds_alerts(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let items: Vec<crate::clinical::CDSAlert> = match data
        .repositories
        .cds_alerts
        .list_all(crate::repositories::traits::Pagination::new(10_000, 0))
        .await
    {
        Ok(p) => p
            .items
            .into_iter()
            .map(crate::clinical::CDSAlert::from)
            .collect(),
        Err(e) => {
            log::error!("Failed to list CDS alerts: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to list alerts".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

// ============================================================================
// ADDITIONAL FRONTEND-COMPATIBLE ENDPOINTS
// ============================================================================

/// Record vital signs (alias for /api/clinical/vitals for frontend compatibility)
#[post("/api/clinical/vitals/record")]
pub async fn record_vital_signs(
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let patient_id = body
        .get("patient_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if patient_id.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "MISSING_FIELD".to_string(),
        });
    }

    let reading = clinical::VitalSignsReading {
        reading_id: format!("VS-{}", uuid::Uuid::new_v4()),
        timestamp: chrono::Utc::now().timestamp(),
        recorded_by: current_user.wallet_address.clone(),
        heart_rate: body
            .get("heart_rate")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        respiratory_rate: body
            .get("respiratory_rate")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        systolic_bp: body
            .get("blood_pressure_systolic")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        diastolic_bp: body
            .get("blood_pressure_diastolic")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        temperature_celsius: body
            .get("temperature_celsius")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32),
        oxygen_saturation: body
            .get("oxygen_saturation")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        pain_scale: body
            .get("pain_scale")
            .and_then(|v| v.as_i64())
            .map(|v| v as u8),
        notes: body
            .get("notes")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };

    // Store in vitals repository
    let entity = VitalSignsEntity {
        id: reading.reading_id.clone(),
        patient_id: patient_id.to_string(),
        heart_rate: reading.heart_rate.map(|v| v as i32),
        respiratory_rate: reading.respiratory_rate.map(|v| v as i32),
        blood_pressure_systolic: reading.systolic_bp.map(|v| v as i32),
        blood_pressure_diastolic: reading.diastolic_bp.map(|v| v as i32),
        mean_arterial_pressure: None, // Calculated in repo or service if needed
        temperature: reading.temperature_celsius.map(|v| v as f64),
        temperature_site: None,
        oxygen_saturation: reading.oxygen_saturation.map(|v| v as i32),
        oxygen_delivery: None,
        fio2: None,
        pain_scale: reading.pain_scale.map(|v| v as i32),
        gcs_score: None,
        gcs_eye: None,
        gcs_verbal: None,
        gcs_motor: None,
        blood_glucose: None,
        weight_kg: None,
        height_cm: None,
        bmi: None,
        position: None,
        activity_level: None,
        is_critical: false, // Updated by CDS evaluation below
        critical_values: None,
        recorded_at: chrono::DateTime::from_timestamp(reading.timestamp, 0)
            .unwrap_or_else(Utc::now),
        recorded_by: reading.recorded_by.clone(),
        facility_id: None,
        created_at: Utc::now(),
    };

    if let Err(e) = data.repositories.vital_signs.create(entity).await {
        log::error!("Failed to store vital signs in repository: {}", e);
        // We continue for now to keep demo functionality if repo fails,
        // but in production this should probably return an error.
    }

    // Trigger automated CDS rules evaluation with the patient's conditions + meds
    {
        let patient_id_for_cds = patient_id.to_string();
        let (conditions, meds) = patient_conditions_and_meds(&data, &patient_id_for_cds).await;
        run_and_persist_cds_alerts(
            &data,
            &patient_id_for_cds,
            Some(&reading),
            None,
            &conditions,
            &meds,
        )
        .await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "reading_id": reading.reading_id,
        "message": "Vital signs recorded successfully"
    }))
}

/// List all progress notes
#[get("/api/clinical/progress-notes")]
pub async fn list_progress_notes(
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

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    let note_list: Vec<serde_json::Value> =
        match data.repositories.progress_notes.list_all(pagination).await {
            Ok(result) => result.items.into_iter().map(|e| e.data).collect(),
            Err(e) => {
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: e.to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                })
            }
        };

    HttpResponse::Ok().json(serde_json::json!({
        "notes": note_list,
        "total": note_list.len()
    }))
}

/// List all incident reports
#[get("/api/clinical/incident-reports")]
pub async fn list_incident_reports(
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

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data
        .repositories
        .incident_reports
        .list_all(pagination)
        .await
    {
        Ok(result) => {
            let report_list: Vec<serde_json::Value> =
                result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(report_list)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all intake/output records
#[get("/api/clinical/intake-output")]
pub async fn list_intake_output(
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

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record_list = match data
        .repositories
        .io_records
        .list_all(Pagination::new(0, 1000))
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(record_list)
}

/// List all AMA discharges (Against Medical Advice)
#[get("/api/clinical/ama-discharges")]
pub async fn list_ama_discharges(
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

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.ama_discharges.list_all(pagination).await {
        Ok(result) => {
            let record_list: Vec<serde_json::Value> =
                result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(record_list)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
