use super::*;

// ============================================================================
// OFFLINE DATA SYNC
// ============================================================================

/// Device registration for sync
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct RegisterDeviceRequest {
    pub device_name: String,
    pub device_type: String,
    pub os: String,
    pub app_version: String,
}

/// Sync request from mobile/web
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct SyncRequest {
    pub device_id: String,
    pub last_sync_at: i64,
    pub items: Vec<SyncItemInput>,
}

/// Input item for sync
#[derive(Debug, Deserialize)]
pub struct SyncItemInput {
    pub entity_type: String,
    pub operation: String,
    pub data: serde_json::Value,
    pub client_timestamp: i64,
}

/// Request to resolve a sync conflict
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ResolveConflictRequest {
    pub resolution: String, // "client_wins" or "server_wins"
    pub merged_data: Option<serde_json::Value>,
}

/// Get current sync status for a device
#[get("/api/platform/sync/status/{device_id}")]
pub async fn get_sync_status(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let device_id = path.into_inner();

    // Mock status
    HttpResponse::Ok().json(serde_json::json!({
        "device_id": device_id,
        "last_successful_sync": chrono::Utc::now().timestamp() - 3600,
        "pending_server_changes": 0,
        "status": "healthy"
    }))
}

/// Register a device for offline synchronization
#[post("/api/platform/sync/register")]
pub async fn register_sync_device(
    _data: web::Data<crate::AppState>,
    _http_req: HttpRequest,
    _req: web::Json<RegisterDeviceRequest>,
) -> impl Responder {
    let device_id = format!(
        "DEV-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "device_id": device_id,
        "message": "Device registered for sync"
    }))
}

/// Perform bidirectional sync
#[post("/api/platform/sync")]
pub async fn perform_sync(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SyncRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let mut processed_count = 0;
    let mut conflicts = Vec::new();

    // Process incoming items
    for item in &req.items {
        // Mock conflict detection
        if item.client_timestamp < chrono::Utc::now().timestamp() - 10000 {
            conflicts.push(serde_json::json!({
                "entity_type": item.entity_type,
                "server_data": {"info": "Existing server version"},
                "client_data": item.data
            }));
        } else {
            // Push to sync queue repository
            let queue_id = uuid::Uuid::new_v4().to_string();
            let operation = match item.operation.as_str() {
                "create" | "Create" => crate::clinical::SyncOperation::Create,
                "update" | "Update" => crate::clinical::SyncOperation::Update,
                "delete" | "Delete" => crate::clinical::SyncOperation::Delete,
                "merge" | "Merge" => crate::clinical::SyncOperation::Merge,
                _ => crate::clinical::SyncOperation::Update,
            };
            let entity_id = item
                .data
                .get("id")
                .or_else(|| item.data.get("entity_id"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| queue_id.clone());
            let queue_item = crate::clinical::SyncQueueItem {
                queue_id: queue_id.clone(),
                device_id: req.device_id.clone(),
                user_id: current_user_id.clone(),
                entity_type: item.entity_type.clone(),
                entity_id,
                operation,
                data: item.data.clone(),
                created_at: chrono::Utc::now().timestamp(),
                priority: crate::clinical::SyncPriority::Normal,
                attempts: 0,
                last_attempt_at: None,
                last_error: None,
                status: crate::clinical::SyncItemStatus::Pending,
            };

            let now_dt = chrono::Utc::now();
            let entity = crate::repositories::traits::JsonRecordEntity {
                id: queue_item.queue_id.clone(),
                owner_id: queue_item.user_id.clone(),
                data: serde_json::to_value(&queue_item).unwrap_or_default(),
                created_at: now_dt,
                updated_at: now_dt,
            };
            let _ = data.repositories.sync_queue_items.create(entity).await;
            processed_count += 1;
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "processed": processed_count,
        "conflicts": conflicts,
        "sync_timestamp": chrono::Utc::now().timestamp()
    }))
}

/// Get pending sync conflicts
#[get("/api/platform/sync/conflicts")]
pub async fn get_sync_conflicts(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }

    // Mock conflicts
    HttpResponse::Ok().json(serde_json::json!({
        "conflicts": []
    }))
}

/// Resolve a specific sync conflict
#[post("/api/platform/sync/conflicts/{conflict_id}/resolve")]
pub async fn resolve_sync_conflict(
    _data: web::Data<crate::AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<ResolveConflictRequest>,
) -> impl Responder {
    let conflict_id = path.into_inner();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "conflict_id": conflict_id,
        "resolution": req.resolution
    }))
}

/// Get the sync queue for a user/device
#[get("/api/platform/sync/queue/{device_id}")]
pub async fn get_sync_queue(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let device_id = path.into_inner();

    // Filter queue by device
    let all_records = data
        .repositories
        .sync_queue_items
        .list_all()
        .await
        .unwrap_or_default();
    let queue: Vec<crate::clinical::SyncQueueItem> = all_records
        .into_iter()
        .filter_map(|rec| serde_json::from_value::<crate::clinical::SyncQueueItem>(rec.data).ok())
        .filter(|i| i.user_id == current_user_id && i.device_id == device_id)
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "device_id": device_id,
        "queue": queue,
        "count": queue.len()
    }))
}

/// Download bulk data for offline use
#[get("/api/platform/sync/download/{patient_id}")]
pub async fn download_offline_data(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    // Auth check
    if current_user_id != patient_id && !current_user_id.starts_with("0xPROV") {
        return HttpResponse::Forbidden().finish();
    }

    // Bundle patient data
    let patient = data.repositories.patients.get_by_id(&patient_id).await.ok();
    let pagination = Pagination::new(0, 100);
    let records = data
        .repositories
        .medical_records
        .get_by_patient(&patient_id, pagination.clone())
        .await
        .map(|result| result.items)
        .unwrap_or_default();
    let vitals = data
        .repositories
        .vital_signs
        .get_by_patient(&patient_id, pagination)
        .await
        .map(|result| result.items)
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "patient": patient,
        "records": records,
        "vitals": vitals,
        "downloaded_at": chrono::Utc::now().timestamp()
    }))
}
