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

    // Check Blockchain health (Substrate node)
    let bc_start = Instant::now();
    let bc_connected = match &data.substrate_client {
        Some(client) => client.health_check().await,
        None => false,
    };
    let bc_latency = bc_start.elapsed().as_millis() as u64;
    services.push(ServiceHealth {
        name: "Blockchain (Substrate)".to_string(),
        status: if bc_connected {
            "online".to_string()
        } else {
            "offline".to_string()
        },
        latency_ms: Some(bc_latency),
        message: if bc_connected {
            Some("Substrate node connected".to_string())
        } else {
            Some("Substrate node connection failed".to_string())
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

/// Validates a patient-registration request's string fields and blood type.
/// Returns the parsed blood type, or the exact `HttpResponse` to send back.
fn validate_register_patient_request(
    req: &RegisterPatientRequest,
) -> Result<BloodType, HttpResponse> {
    validation::validate_string_length(&req.full_name, "full_name", validation::MAX_NAME_LENGTH)
        .map_err(|e| {
            HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: e,
                code: "VALIDATION_ERROR".to_string(),
            })
        })?;
    validation::validate_string_length(&req.national_id, "national_id", validation::MAX_ID_LENGTH)
        .map_err(|e| {
            HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: e,
                code: "VALIDATION_ERROR".to_string(),
            })
        })?;
    if req.full_name.trim().is_empty() {
        return Err(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "full_name cannot be empty".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        }));
    }
    if req.national_id.trim().is_empty() {
        return Err(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "national_id cannot be empty".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        }));
    }
    parse_blood_type(&req.blood_type).map_err(|e| {
        HttpResponse::BadRequest().json(RegisterPatientResponse {
            success: false,
            patient_id: String::new(),
            nfc_tag_id: String::new(),
            chain_status: None,
            blockchain_tx_hash: None,
            message: e,
        })
    })
}

/// Canonicalise an administrative gender to a known value.
///
/// Registration accepts the field as free text over the wire, so this maps the
/// common spellings onto the fixed set the UI filters on and drops anything
/// else. Returning `None` for blank or unrecognised input is deliberate: an
/// unrecorded gender must stay unrecorded rather than be guessed, and the
/// patient list omits the field entirely when it is `None`.
fn normalized_gender(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim().to_lowercase();
    match value.as_str() {
        "male" | "m" => Some("male".to_string()),
        "female" | "f" => Some("female".to_string()),
        "other" => Some("other".to_string()),
        "unknown" | "prefer_not_to_say" => Some("unknown".to_string()),
        _ => None,
    }
}

/// Builds the new patient's profile + NFC tag from a validated request.
/// `patient_id`/`nfc_tag_id` are generated by the caller so the tag's hash
/// (which binds both IDs together) can be computed here.
fn build_new_patient(
    req: &RegisterPatientRequest,
    blood_type: BloodType,
    patient_id: &str,
    nfc_tag_id: &str,
) -> (PatientProfile, NfcTagData) {
    let emergency_info = EmergencyInfo {
        patient_id: patient_id.to_string(),
        blood_type,
        // Convert simple string allergies to structured Allergy with default severity
        allergies: req
            .allergies
            .iter()
            .map(|name| Allergy {
                name: name.clone(),
                // `Unknown`, not `Mild`. Registration receives a bare allergen
                // name — nobody assessed the reaction — so recording "Mild" is
                // a fabricated clinical judgement, and a dangerous one: the
                // emergency card used to filter Mild allergies out entirely, so
                // a patient registered with a penicillin allergy showed NO
                // allergies to a paramedic. Unknown severity is the truth here.
                severity: AllergySeverity::Unknown,
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
        // DNR starts UNVERIFIED at registration; a provider attaches proof later.
        dnr_verified_by: None,
        dnr_verified_at: None,
        dnr_document_ref: None,
        languages: req.languages.clone(),
        last_updated: Utc::now(),
    };

    let patient = PatientProfile {
        patient_id: patient_id.to_string(),
        full_name: req.full_name.clone(),
        date_of_birth: req.date_of_birth.clone(),
        time_of_birth: req.time_of_birth.clone(),
        national_id: req.national_id.clone(),
        gender: normalized_gender(req.gender.as_deref()),
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

    let hash = generate_nfc_hash(patient_id, nfc_tag_id);
    let nfc_tag = NfcTagData {
        tag_id: nfc_tag_id.to_string(),
        patient_id: patient_id.to_string(),
        hash,
        created_at: Utc::now(),
    };

    (patient, nfc_tag)
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

    let blood_type = match validate_register_patient_request(&req) {
        Ok(bt) => bt,
        Err(resp) => return resp,
    };
    let patient_wallet = req
        .wallet_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if crate::blockchain::blockchain_enabled() && patient_wallet.is_none() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "wallet_address is required when blockchain integration is enabled".to_string(),
            code: "PATIENT_WALLET_REQUIRED".to_string(),
        });
    }
    if patient_wallet.is_some_and(|wallet| !is_valid_wallet_address(wallet)) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "wallet_address must be a valid SS58 address".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

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

    let (patient, nfc_tag) = build_new_patient(&req, blood_type, &patient_id, &nfc_tag_id);

    // Persist patient + NFC tag atomically via repository (was: in-memory HashMap).
    // PHI encrypted at rest; full profile in encrypted blob for lossless reads. On
    // PostgreSQL both rows commit in one transaction so neither is orphaned on failure.
    {
        let mut entity = patient_profile_to_entity(&patient, &data.encryption_keyring);
        entity.wallet_address = patient_wallet.map(str::to_string);
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
                chain_status: None,
                blockchain_tx_hash: None,
                message: "Failed to persist patient record".to_string(),
            });
        }
    }

    // Create an account only when a real patient-owned wallet was supplied.
    if let Some(wallet_address) = patient_wallet {
        let patient_user = User {
            wallet_address: wallet_address.to_string(),
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
        if let Err(e) = data.persist_then_cache_user(patient_user).await {
            log::error!(
                "Failed to persist auto-created patient user {}: {}",
                patient_id,
                e
            );
            return HttpResponse::ServiceUnavailable().json(RegisterPatientResponse {
                success: false,
                patient_id,
                nfc_tag_id,
                chain_status: None,
                blockchain_tx_hash: None,
                message: "Patient record was created, but account persistence failed; retry account provisioning"
                    .to_string(),
            });
        }
    }

    log::info!(
        "Registered new patient: {} with NFC tag: {} by provider: {}",
        patient_id,
        nfc_tag_id,
        current_user_id
    );

    let id_hash = crate::support::hash_national_id(&req.national_id);
    let chain_anchor = match crate::audit_outbox::anchor_patient_registration_or_queue(
        &data,
        &patient_id,
        patient_wallet.unwrap_or_default(),
        &id_hash,
        "national_id",
        &current_user_id,
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            log::error!("Patient chain registration could not be finalized or queued: {error}");
            return HttpResponse::ServiceUnavailable().json(RegisterPatientResponse {
                success: false,
                patient_id,
                nfc_tag_id,
                chain_status: None,
                blockchain_tx_hash: None,
                message: "Patient record was created, but its required blockchain registration could not be queued."
                    .to_string(),
            });
        }
    };

    if let Err(error) =
        crate::emergency_capsule::publish_capsule(&data, &patient.emergency_info, &current_user_id)
            .await
    {
        log::error!("Emergency capsule publication failed: {error}");
        return HttpResponse::ServiceUnavailable().json(RegisterPatientResponse {
            success: false,
            patient_id,
            nfc_tag_id,
            chain_status: Some(chain_anchor.status),
            blockchain_tx_hash: chain_anchor.transaction_hash,
            message: "Patient record was created, but the emergency capsule could not be stored and queued for anchoring."
                .to_string(),
        });
    }

    HttpResponse::Created().json(RegisterPatientResponse {
        success: true,
        patient_id,
        nfc_tag_id,
        chain_status: Some(chain_anchor.status),
        blockchain_tx_hash: chain_anchor.transaction_hash,
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
                chain_audit_status: None,
                blockchain_tx_hash: None,
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
    let (emergency_info, patient_chain_account) = {
        let entity = match data.repositories.patients.get_by_id(&patient_id).await {
            Ok(e) => e,
            Err(_) => {
                return HttpResponse::NotFound().json(EmergencyAccessResponse {
                    success: false,
                    access_id: String::new(),
                    emergency_info: None,
                    chain_audit_status: None,
                    blockchain_tx_hash: None,
                    message: "Patient record not found.".to_string(),
                });
            }
        };
        let patient_chain_account = entity.wallet_address.clone();
        match patient_entity_to_profile(&entity, &data.encryption_keyring) {
            Some(profile) => (profile.emergency_info, patient_chain_account),
            None => {
                return HttpResponse::NotFound().json(EmergencyAccessResponse {
                    success: false,
                    access_id: String::new(),
                    emergency_info: None,
                    chain_audit_status: None,
                    blockchain_tx_hash: None,
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
    if crate::blockchain::blockchain_enabled() && patient_chain_account.is_none() {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Emergency access was recorded, but the patient has no blockchain wallet for the required chain audit."
                .to_string(),
            code: "PATIENT_WALLET_REQUIRED".to_string(),
        });
    }
    let chain_anchor = match crate::audit_outbox::anchor_access_or_queue(
        &data,
        "emergency_access",
        &access_id,
        patient_chain_account.as_deref().unwrap_or_default(),
        &current_user_id,
        "EMERGENCY_ACCESS",
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            log::error!("Emergency chain audit could not be finalized or queued: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Emergency access was recorded, but its required chain audit could not be queued."
                    .to_string(),
                code: "CHAIN_AUDIT_UNAVAILABLE".to_string(),
            });
        }
    };

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
        chain_audit_status: Some(chain_anchor.status),
        blockchain_tx_hash: chain_anchor.transaction_hash,
        message: "Emergency access granted. All accesses are logged and auditable.".to_string(),
    })
}
