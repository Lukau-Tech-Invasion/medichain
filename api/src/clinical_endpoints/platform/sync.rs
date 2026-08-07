use super::*;

// ============================================================================
// OFFLINE DATA SYNC
// ============================================================================
//
// Route prefix fixed 2026-07-22: these handlers were registered under
// `/api/platform/sync/...` while every frontend caller (shared `endpoints.ts`,
// `OfflineSyncPage`) has always called `/api/sync/...` — the whole offline-sync
// vertical was silently 404ing. Also replaced the mock conflict handling
// (hardcoded "healthy" status, always-empty conflict list, a non-persisting
// "resolve" stub) with real `SyncConflictRepository`-backed detection/listing/
// resolution, and made `register_sync_device` actually persist the device.

/// Device registration for sync
#[derive(Debug, Deserialize)]
pub struct RegisterDeviceRequest {
    pub device_name: String,
    pub device_type: String,
    pub os: String,
    pub app_version: String,
}

/// Sync request from mobile/web
#[derive(Debug, Deserialize)]
pub struct SyncRequest {
    #[serde(default)]
    pub device_id: String,
    // Accepted from clients for a future incremental-sync optimization
    // (bounding the conflict-candidate scan to changes since this point);
    // not yet consumed — conflict detection currently scans the full queue.
    #[serde(default)]
    #[allow(dead_code)]
    pub last_sync_at: i64,
    #[serde(default)]
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
#[derive(Debug, Deserialize)]
pub struct ResolveConflictRequest {
    pub resolution: String, // "UseLocal", "UseServer", or "Merge"
    pub merged_data: Option<serde_json::Value>,
}

/// Fetch all sync-queue items belonging to `user_id` on `device_id`.
async fn device_queue_items(
    data: &crate::AppState,
    user_id: &str,
    device_id: &str,
) -> Vec<crate::clinical::SyncQueueItem> {
    data.repositories
        .sync_queue_items
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|rec| serde_json::from_value::<crate::clinical::SyncQueueItem>(rec.data).ok())
        .filter(|i| i.user_id == user_id && i.device_id == device_id)
        .collect()
}

/// Get current sync status for a device
#[get("/api/sync/status/{device_id}")]
pub async fn get_sync_status(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let device_id = path.into_inner();

    let queue = device_queue_items(&data, &current_user_id, &device_id).await;
    let pending_count = queue
        .iter()
        .filter(|i| matches!(i.status, crate::clinical::SyncItemStatus::Pending))
        .count();
    let last_successful_sync = queue.iter().map(|i| i.created_at).max().unwrap_or(0);

    HttpResponse::Ok().json(serde_json::json!({
        "device_id": device_id,
        "last_successful_sync": last_successful_sync,
        "pending_server_changes": pending_count,
        "status": if pending_count == 0 { "healthy" } else { "pending" }
    }))
}

/// Register a device for offline synchronization
#[post("/api/sync/register")]
pub async fn register_sync_device(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<RegisterDeviceRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let device_id = format!(
        "DEV-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let now = chrono::Utc::now();
    let record = serde_json::json!({
        "device_id": device_id,
        "owner_id": current_user_id,
        "device_name": req.device_name,
        "device_type": req.device_type,
        "os": req.os,
        "app_version": req.app_version,
        "registered_at": now.timestamp(),
    });
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: device_id.clone(),
        owner_id: current_user_id,
        data: record,
        created_at: now,
        updated_at: now,
    };
    let _ = data.repositories.sync_devices.create(entity).await;

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "device_id": device_id,
        "message": "Device registered for sync"
    }))
}

/// Find the newest queued item for the same entity from a *different* device.
/// Returns it only when the incoming item's client timestamp is older than
/// that item's arrival — i.e. this write is stale relative to a change that
/// already landed from elsewhere (last-write-wins conflict).
fn find_conflicting_item<'a>(
    existing_items: &'a [crate::clinical::SyncQueueItem],
    entity_type: &str,
    entity_id: &str,
    device_id: &str,
    client_timestamp: i64,
) -> Option<&'a crate::clinical::SyncQueueItem> {
    existing_items
        .iter()
        .filter(|existing| {
            existing.entity_type == entity_type
                && existing.entity_id == entity_id
                && existing.device_id != device_id
        })
        .max_by_key(|existing| existing.created_at)
        .filter(|existing| client_timestamp < existing.created_at)
}

/// Persist a detected conflict and build its response-facing JSON.
async fn record_sync_conflict(
    data: &crate::AppState,
    item: &SyncItemInput,
    entity_id: &str,
    current_user_id: &str,
    existing: &crate::clinical::SyncQueueItem,
) -> serde_json::Value {
    let patient_id = item
        .data
        .get("patient_id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| current_user_id.to_string());
    let local_value = serde_json::to_string(&item.data).unwrap_or_default();
    let remote_value = serde_json::to_string(&existing.data).unwrap_or_default();
    let conflict_id = uuid::Uuid::new_v4().to_string();

    let entity = crate::repositories::traits::SyncConflictEntity {
        id: conflict_id.clone(),
        entity_type: item.entity_type.clone(),
        entity_id: entity_id.to_string(),
        patient_id: Some(patient_id),
        conflict_type: "concurrent_update".to_string(),
        local_value: Some(local_value.clone()),
        remote_value: Some(remote_value.clone()),
        local_timestamp: chrono::DateTime::from_timestamp(item.client_timestamp, 0),
        remote_timestamp: chrono::DateTime::from_timestamp(existing.created_at, 0),
        status: Some("pending".to_string()),
        created_at: Some(chrono::Utc::now()),
        ..Default::default()
    };
    let _ = data.repositories.sync_conflicts.create(entity).await;

    serde_json::json!({
        "id": conflict_id,
        "entity_type": item.entity_type,
        "entity_id": entity_id,
        "local_value": local_value,
        "remote_value": remote_value,
    })
}

/// Perform bidirectional sync
#[post("/api/sync")]
pub async fn perform_sync(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SyncRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let existing_items: Vec<crate::clinical::SyncQueueItem> = data
        .repositories
        .sync_queue_items
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|rec| serde_json::from_value(rec.data).ok())
        .collect();

    let mut processed_count = 0;
    let mut conflicts = Vec::new();

    for item in &req.items {
        let entity_id = item
            .data
            .get("id")
            .or_else(|| item.data.get("entity_id"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let conflict = find_conflicting_item(
            &existing_items,
            &item.entity_type,
            &entity_id,
            &req.device_id,
            item.client_timestamp,
        );

        if let Some(existing) = conflict {
            conflicts.push(
                record_sync_conflict(&data, item, &entity_id, &current_user_id, existing).await,
            );
            continue;
        }

        let operation = match item.operation.as_str() {
            "create" | "Create" => crate::clinical::SyncOperation::Create,
            "update" | "Update" => crate::clinical::SyncOperation::Update,
            "delete" | "Delete" => crate::clinical::SyncOperation::Delete,
            "merge" | "Merge" => crate::clinical::SyncOperation::Merge,
            _ => crate::clinical::SyncOperation::Update,
        };
        let queue_item = crate::clinical::SyncQueueItem {
            queue_id: uuid::Uuid::new_v4().to_string(),
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

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "processed": processed_count,
        "conflicts": conflicts,
        "sync_timestamp": chrono::Utc::now().timestamp()
    }))
}

/// Get pending sync conflicts for the current patient
#[get("/api/sync/conflicts")]
pub async fn get_sync_conflicts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let conflicts: Vec<_> = data
        .repositories
        .sync_conflicts
        .get_pending()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|c| c.patient_id.as_deref() == Some(current_user_id.as_str()))
        .map(|c| {
            serde_json::json!({
                "id": c.id,
                "entity_type": c.entity_type,
                "entity_id": c.entity_id,
                "local_value": c.local_value,
                "remote_value": c.remote_value,
                "conflict_type": c.conflict_type,
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({ "conflicts": conflicts }))
}

/// Resolve a specific sync conflict
#[post("/api/sync/conflicts/{conflict_id}/resolve")]
pub async fn resolve_sync_conflict(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<ResolveConflictRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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
                error: format!("Sync conflict '{}' not found", conflict_id),
                code: "CONFLICT_NOT_FOUND".to_string(),
            })
        }
    };

    if conflict.patient_id.as_deref() != Some(current_user_id.as_str()) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let resolved_value = match req.resolution.as_str() {
        "UseLocal" => conflict.local_value.clone().unwrap_or_default(),
        "UseServer" => conflict.remote_value.clone().unwrap_or_default(),
        "Merge" => req
            .merged_data
            .as_ref()
            .map(|v| v.to_string())
            .unwrap_or_default(),
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "resolution must be one of UseLocal, UseServer, Merge".to_string(),
                code: "INVALID_RESOLUTION".to_string(),
            })
        }
    };

    if data
        .repositories
        .sync_conflicts
        .resolve(&conflict_id, &resolved_value, &current_user_id, None)
        .await
        .is_err()
    {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to resolve conflict".to_string(),
            code: "RESOLVE_FAILED".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "conflict_id": conflict_id,
        "resolution": req.resolution
    }))
}

/// Get the sync queue for a user/device
#[get("/api/sync/queue/{device_id}")]
pub async fn get_sync_queue(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let device_id = path.into_inner();
    let queue = device_queue_items(&data, &current_user_id, &device_id).await;

    HttpResponse::Ok().json(serde_json::json!({
        "device_id": device_id,
        "count": queue.len(),
        "queue": queue,
    }))
}

/// Download bulk data for offline use
#[get("/api/sync/download/{patient_id}")]
pub async fn download_offline_data(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Auth check
    // Horizon HZ-024: this used to accept any caller whose id merely *began*
    // with "0xPROV". Wallet addresses are opaque, caller-supplied identifiers,
    // so that let an unauthenticated request forge provider status with a
    // header and read any patient. Resolve the role from the user store, as
    // `get_symptom_checker_history` already does.
    let is_provider = crate::get_user(&data, &current_user_id)
        .is_some_and(|user| user.role.is_healthcare_provider());
    if !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
        && !is_provider {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn queue_item(
        device_id: &str,
        entity_id: &str,
        created_at: i64,
    ) -> crate::clinical::SyncQueueItem {
        crate::clinical::SyncQueueItem {
            queue_id: format!("Q-{device_id}-{created_at}"),
            device_id: device_id.to_string(),
            user_id: "0xPATIENT".to_string(),
            entity_type: "vital_signs".to_string(),
            entity_id: entity_id.to_string(),
            operation: crate::clinical::SyncOperation::Update,
            data: serde_json::json!({"id": entity_id}),
            created_at,
            priority: crate::clinical::SyncPriority::Normal,
            attempts: 0,
            last_attempt_at: None,
            last_error: None,
            status: crate::clinical::SyncItemStatus::Pending,
        }
    }

    #[test]
    fn no_existing_items_means_no_conflict() {
        let existing: Vec<crate::clinical::SyncQueueItem> = Vec::new();
        assert!(find_conflicting_item(&existing, "vital_signs", "E1", "DEV-A", 100).is_none());
    }

    #[test]
    fn same_device_never_conflicts_even_if_older() {
        let existing = vec![queue_item("DEV-A", "E1", 500)];
        // Same device replaying its own earlier write is not a conflict.
        assert!(find_conflicting_item(&existing, "vital_signs", "E1", "DEV-A", 100).is_none());
    }

    #[test]
    fn stale_write_from_another_device_conflicts() {
        let existing = vec![queue_item("DEV-B", "E1", 500)];
        // DEV-A's local edit (timestamp 100) predates DEV-B's write that already
        // landed on the server (created_at 500) — genuine last-write-wins conflict.
        let hit = find_conflicting_item(&existing, "vital_signs", "E1", "DEV-A", 100);
        assert!(hit.is_some());
        assert_eq!(hit.unwrap().device_id, "DEV-B");
    }

    #[test]
    fn newer_incoming_write_does_not_conflict() {
        let existing = vec![queue_item("DEV-B", "E1", 100)];
        // DEV-A's edit (timestamp 500) is newer than DEV-B's prior write (100) —
        // not stale, so it should apply cleanly.
        assert!(find_conflicting_item(&existing, "vital_signs", "E1", "DEV-A", 500).is_none());
    }

    #[test]
    fn picks_the_newest_conflicting_candidate() {
        let existing = vec![
            queue_item("DEV-B", "E1", 200),
            queue_item("DEV-C", "E1", 800),
        ];
        let hit = find_conflicting_item(&existing, "vital_signs", "E1", "DEV-A", 100).unwrap();
        assert_eq!(hit.device_id, "DEV-C");
    }

    #[test]
    fn different_entity_id_is_unrelated() {
        let existing = vec![queue_item("DEV-B", "E2", 999)];
        assert!(find_conflicting_item(&existing, "vital_signs", "E1", "DEV-A", 1).is_none());
    }
}
