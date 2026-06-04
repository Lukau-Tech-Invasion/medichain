use super::*;

// ============================================================================
// API Endpoints
// ============================================================================

/// Health check endpoint
#[get("/health")]
pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(HealthCheckResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: Utc::now(),
        blockchain_connected: false, // Updated by actual blockchain client - see /health/db
    })
}

/// Readiness probe (graceful degradation).
///
/// Returns 200 when the active storage backend can serve writes. For the
/// PostgreSQL backend it returns `503 Service Unavailable` with a `Retry-After`
/// header when the connection pool is unhealthy, so load balancers stop routing
/// traffic during a database outage instead of surfacing opaque write errors.
/// The in-memory backend is always ready (writes never touch the network).
#[get("/health/ready")]
pub async fn readiness_check(data: web::Data<AppState>) -> impl Responder {
    let is_postgres = matches!(
        data.repositories.backend,
        crate::repositories::StorageBackend::Postgres
    );
    if is_postgres {
        if let Some(pool) = &data.db_pool {
            if !crate::db::check_health(pool).await {
                return HttpResponse::ServiceUnavailable()
                    .insert_header(("Retry-After", "5"))
                    .json(serde_json::json!({
                        "status": "unavailable",
                        "ready": false,
                        "reason": "PostgreSQL connection unhealthy",
                    }));
            }
        }
    }
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ready",
        "ready": true,
        "backend": if is_postgres { "postgres" } else { "memory" },
    }))
}

/// Database health check endpoint - shows PostgreSQL connection status
#[get("/health/db")]
pub async fn db_health_check(data: web::Data<AppState>) -> impl Responder {
    let users_count = data.users.read().map(|u| u.len()).unwrap_or(0);

    let (db_connected, message, pool_stats) = match &data.db_pool {
        Some(pool) => {
            let stats = crate::db::get_pool_stats(pool);
            match crate::db::check_health(pool).await {
                true => (
                    true,
                    "PostgreSQL connected - demo users persist across restarts".to_string(),
                    Some(stats),
                ),
                false => (
                    false,
                    "PostgreSQL connection lost - using in-memory fallback".to_string(),
                    Some(stats),
                ),
            }
        }
        None => (
            false,
            "No database configured - using in-memory storage (data lost on restart)".to_string(),
            None,
        ),
    };

    let db_empty = match &data.db_pool {
        Some(pool) if db_connected => crate::db::is_database_empty(pool).await.unwrap_or(true),
        _ => true,
    };

    HttpResponse::Ok().json(serde_json::json!({
        "status": if db_connected { "healthy" } else { "degraded" },
        "database_connected": db_connected,
        "users_loaded": users_count,
        "demo_users_available": users_count > 0,
        "database_empty": db_empty,
        "pool_stats": pool_stats,
        "message": message,
    }))
}

/// Detailed health check endpoint for system monitoring
/// Returns comprehensive status of all system components
#[get("/api/health/detailed")]
pub async fn detailed_health_check(data: web::Data<AppState>) -> impl Responder {
    use std::time::Instant;

    #[derive(Serialize)]
    struct ServiceHealth {
        name: String,
        status: String,
        latency_ms: Option<u64>,
        message: Option<String>,
    }

    #[derive(Serialize)]
    struct DetailedHealthResponse {
        overall_status: String,
        version: String,
        uptime_seconds: u64,
        timestamp: chrono::DateTime<Utc>,
        services: Vec<ServiceHealth>,
    }

    let mut services = Vec::new();

    // Check API health (always online if we got here)
    services.push(ServiceHealth {
        name: "API Server".to_string(),
        status: "online".to_string(),
        latency_ms: Some(0),
        message: Some(format!("v{}", env!("CARGO_PKG_VERSION"))),
    });

    // Check Database health
    let db_start = Instant::now();
    let (db_status, db_msg) = match &data.db_pool {
        Some(pool) => match crate::db::check_health(pool).await {
            true => (
                "online".to_string(),
                Some("PostgreSQL connected".to_string()),
            ),
            false => (
                "offline".to_string(),
                Some("PostgreSQL connection failed".to_string()),
            ),
        },
        None => (
            "degraded".to_string(),
            Some("Using in-memory storage".to_string()),
        ),
    };
    let db_latency = db_start.elapsed().as_millis() as u64;
    services.push(ServiceHealth {
        name: "Database".to_string(),
        status: db_status.clone(),
        latency_ms: Some(db_latency),
        message: db_msg,
    });

    // Check IPFS health
    let ipfs_start = Instant::now();
    let ipfs_connected = data.ipfs_client.health_check().await.unwrap_or(false);
    let ipfs_latency = ipfs_start.elapsed().as_millis() as u64;
    services.push(ServiceHealth {
        name: "IPFS Storage".to_string(),
        status: if ipfs_connected {
            "online".to_string()
        } else {
            "offline".to_string()
        },
        latency_ms: Some(ipfs_latency),
        message: if ipfs_connected {
            Some("IPFS daemon connected".to_string())
        } else {
            Some("IPFS not available".to_string())
        },
    });

    // Determine overall status
    let overall_status = if services.iter().all(|s| s.status == "online") {
        "healthy".to_string()
    } else if services.iter().any(|s| s.status == "offline") {
        "degraded".to_string()
    } else {
        "healthy".to_string()
    };

    // Calculate uptime (approximate based on when the app data was created)
    let uptime_seconds = data.start_time.elapsed().as_secs();

    HttpResponse::Ok().json(DetailedHealthResponse {
        overall_status,
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds,
        timestamp: Utc::now(),
        services,
    })
}

/// Register a new patient (Healthcare providers only)
#[post("/api/register")]
pub async fn register_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RegisterPatientRequest>,
) -> impl Responder {
    // RBAC: Check if caller is a healthcare provider
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header. Only healthcare providers can register patients."
                    .to_string(),
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
            error: format!(
                "Only healthcare providers can register patients. Your role: {}",
                current_user.role
            ),
            code: "NOT_HEALTHCARE_PROVIDER".to_string(),
        });
    }

    // Input validation
    if let Err(e) =
        validation::validate_string_length(&req.full_name, "full_name", validation::MAX_NAME_LENGTH)
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if let Err(e) = validation::validate_string_length(
        &req.national_id,
        "national_id",
        validation::MAX_ID_LENGTH,
    ) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if req.full_name.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "full_name cannot be empty".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if req.national_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "national_id cannot be empty".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    // Parse blood type
    let blood_type = match parse_blood_type(&req.blood_type) {
        Ok(bt) => bt,
        Err(e) => {
            return HttpResponse::BadRequest().json(RegisterPatientResponse {
                success: false,
                patient_id: String::new(),
                nfc_tag_id: String::new(),
                message: e,
            });
        }
    };

    // Generate IDs
    let patient_id = format!(
        "PAT-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );
    let nfc_tag_id = format!(
        "NFC-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create emergency info
    let emergency_info = EmergencyInfo {
        patient_id: patient_id.clone(),
        blood_type,
        // Convert simple string allergies to structured Allergy with default severity
        allergies: req
            .allergies
            .iter()
            .map(|name| Allergy {
                name: name.clone(),
                severity: AllergySeverity::Mild, // Default to Mild, can be updated later
                reaction: None,
                verified_at: None,
            })
            .collect(),
        current_medications: req.current_medications.clone(),
        chronic_conditions: req.chronic_conditions.clone(),
        emergency_contacts: vec![EmergencyContact {
            name: req.emergency_contact_name.clone(),
            phone: req.emergency_contact_phone.clone(),
            relationship: req.emergency_contact_relationship.clone(),
            priority: 1,
            can_make_medical_decisions: false,
            language: None,
        }],
        organ_donor: req.organ_donor,
        dnr_status: req.dnr_status,
        languages: req.languages.clone(),
        last_updated: Utc::now(),
    };

    // Create patient profile
    let patient = PatientProfile {
        patient_id: patient_id.clone(),
        full_name: req.full_name.clone(),
        date_of_birth: req.date_of_birth.clone(),
        national_id: req.national_id.clone(),
        phone: req.phone.clone(),
        emergency_info,
        address: None,
        insurance: None,
        primary_doctor: None,
        community_health_worker: None,
        preferences: PatientPreferences::default(),
        advanced_directives: vec![],
        family_notifications: None,
        created_at: Utc::now(),
        last_updated: Utc::now(),
    };

    // Create NFC tag
    let hash = generate_nfc_hash(&patient_id, &nfc_tag_id);
    let nfc_tag = NfcTagData {
        tag_id: nfc_tag_id.clone(),
        patient_id: patient_id.clone(),
        hash,
        created_at: Utc::now(),
    };

    // Persist patient + NFC tag atomically via repository (was: in-memory HashMap).
    // PHI encrypted at rest; full profile in encrypted blob for lossless reads. On
    // PostgreSQL both rows commit in one transaction so neither is orphaned on failure.
    {
        let entity = patient_profile_to_entity(&patient, &data.encryption_key);
        if let Err(e) = data
            .repositories
            .create_patient_with_nfc(entity, nfc_tag.into())
            .await
        {
            log::error!("Patient persistence failed: {}", e);
            return HttpResponse::InternalServerError().json(RegisterPatientResponse {
                success: false,
                patient_id: String::new(),
                nfc_tag_id: String::new(),
                message: "Failed to persist patient record".to_string(),
            });
        }
    }

    // Also create a Patient user account for the new patient
    // Note: In wallet-based auth, the patient will link their wallet later
    // For now, we use the patient_id as a placeholder until they link a wallet
    let patient_user = User {
        wallet_address: patient_id.clone(), // Placeholder until wallet is linked
        username: Some(req.full_name.to_lowercase().replace(' ', ".")),
        name: req.full_name.clone(),
        role: Role::Patient,
        created_at: Utc::now(),
        created_by: Some(current_user_id.clone()),
        linked_patient_id: Some(patient_id.clone()),
        email: None,
        phone: None,
        department: None,
        specialty: None,
        license_number: None,
        status: "active".to_string(),
        last_login: None,
    };
    data.users
        .write()
        .unwrap()
        .insert(patient_id.clone(), patient_user);

    log::info!(
        "Registered new patient: {} with NFC tag: {} by provider: {}",
        patient_id,
        nfc_tag_id,
        current_user_id
    );

    // Fire-and-forget blockchain registration (non-fatal if blockchain unavailable)
    {
        let patient_id_clone = patient_id.clone();
        let national_id_clone = req.national_id.clone();
        let id_type_str = "national_id".to_string();
        let registered_by_clone = current_user_id.clone();
        let id_hash = hex::encode(<Sha3_256 as Digest>::digest(national_id_clone.as_bytes()));
        if let Some(ref client) = data.substrate_client {
            let client = client.clone();
            tokio::spawn(async move {
                match client
                    .register_patient_on_chain(
                        &patient_id_clone,
                        &id_hash,
                        &id_type_str,
                        &registered_by_clone,
                    )
                    .await
                {
                    Ok(tx_hash) => log::info!(
                        "Patient {} registered on chain: {}",
                        patient_id_clone,
                        tx_hash
                    ),
                    Err(e) => {
                        log::warn!("Blockchain patient registration failed (non-fatal): {}", e)
                    }
                }
            });
        }
    }

    HttpResponse::Created().json(RegisterPatientResponse {
        success: true,
        patient_id,
        nfc_tag_id,
        message: "Patient registered successfully. NFC tag provisioned.".to_string(),
    })
}

/// Emergency access endpoint - simulates NFC tap by first responder
/// Requires authentication: Only healthcare providers can request emergency access
#[post("/api/emergency-access")]
pub async fn emergency_access(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<EmergencyAccessRequest>,
) -> impl Responder {
    // RBAC: Require authentication for emergency access
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Authentication required for emergency access".to_string(),
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

    // Only healthcare providers can request emergency access
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can request emergency access".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Find NFC tag and get patient_id via repository
    let patient_id = match data.repositories.nfc_tags.get_by_id(&req.nfc_tag_id).await {
        Ok(tag) => tag.patient_id,
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(EmergencyAccessResponse {
                success: false,
                access_id: String::new(),
                emergency_info: None,
                message: "NFC tag not found. Invalid or unregistered tag.".to_string(),
            });
        }
        Err(e) => {
            log::error!("NFC tag lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Internal server error".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    // Get patient emergency info via repository (was: in-memory data.patients HashMap).
    // Decrypts the lossless profile blob to recover structured emergency_info.
    let emergency_info = {
        let entity = match data.repositories.patients.get_by_id(&patient_id).await {
            Ok(e) => e,
            Err(_) => {
                return HttpResponse::NotFound().json(EmergencyAccessResponse {
                    success: false,
                    access_id: String::new(),
                    emergency_info: None,
                    message: "Patient record not found.".to_string(),
                });
            }
        };
        match patient_entity_to_profile(&entity, &data.encryption_key) {
            Some(profile) => profile.emergency_info,
            None => {
                return HttpResponse::NotFound().json(EmergencyAccessResponse {
                    success: false,
                    access_id: String::new(),
                    emergency_info: None,
                    message: "Patient record not found.".to_string(),
                });
            }
        }
    };

    // Generate access ID and log
    let access_id = format!(
        "ACC-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let access_log = AccessLogEntry {
        access_id: access_id.clone(),
        patient_id: patient_id.clone(),
        accessor_id: current_user_id.clone(), // Use authenticated user ID
        accessor_role: current_user.role.to_string(), // Use verified role
        access_type: "emergency".to_string(),
        location: req.location.clone(),
        timestamp: Utc::now(),
        emergency: true,
    };

    // Log access via repository, TOCTOU-safe (Phase 11.1): locks the patient row
    // and verifies it is still active in the same transaction as the log insert.
    if let Err(e) = data
        .repositories
        .record_access_atomic(&patient_id, access_log.into())
        .await
    {
        log::error!("Failed to record emergency access: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to log access".to_string(),
            code: "REPO_ERROR".to_string(),
        });
    }

    // Breach detection (Phase 11.4): flag if this provider is touching an
    // unusually large number of distinct patients in a short window.
    data.security
        .observe_access(&data.ws_manager, &current_user_id, &patient_id)
        .await;

    log::info!(
        "Emergency access granted: {} ({}) accessed patient {} at {:?}",
        current_user_id,
        current_user.role,
        patient_id,
        req.location
    );

    HttpResponse::Ok().json(EmergencyAccessResponse {
        success: true,
        access_id,
        emergency_info: Some(emergency_info),
        message: "Emergency access granted. All accesses are logged and auditable.".to_string(),
    })
}
