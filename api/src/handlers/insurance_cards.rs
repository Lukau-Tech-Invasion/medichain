//! Insurance card CRUD (Phase 13.4).
//!
//! The doctor portal / patient app `InsurancePage` expects
//! `GET/POST/PUT/DELETE /api/insurance/cards`. Cards are stored losslessly as a
//! JSON-record domain (`insurance_cards` table / memory map) keyed by `id`, owned
//! by a patient. Inherits shared imports via `use super::*`.

use super::*;
use crate::pagination::{paginate_cursor, CursorQuery, Cursorable};
use base64::Engine as _;

/// Cursor adapter over a stored insurance-card record.
impl Cursorable for crate::repositories::traits::JsonRecordEntity {
    fn cursor_ts(&self) -> i64 {
        self.created_at.timestamp_millis()
    }
    fn cursor_id(&self) -> String {
        self.id.clone()
    }
}

/// Merge the storage envelope (`id`, timestamps) into the card's JSON body.
fn card_json(e: &crate::repositories::traits::JsonRecordEntity) -> serde_json::Value {
    let mut v = e.data.clone();
    if let Some(obj) = v.as_object_mut() {
        obj.insert("id".to_string(), serde_json::json!(e.id));
        obj.insert("patient_id".to_string(), serde_json::json!(e.owner_id));
        obj.insert("created_at".to_string(), serde_json::json!(e.created_at));
        obj.insert("updated_at".to_string(), serde_json::json!(e.updated_at));
    }
    v
}

fn require_auth(req: &HttpRequest) -> Result<String, HttpResponse> {
    get_current_user_id(req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Authentication required".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })
    })
}

/// List a patient's insurance cards, cursor-paginated (Phase 9.3).
///
/// GET /api/insurance/cards/{patient_id}?limit=N&cursor=<opaque>
#[get("/api/insurance/cards/{patient_id}")]
pub async fn list_insurance_cards(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<CursorQuery>,
) -> impl Responder {
    if let Err(resp) = require_auth(&req) {
        return resp;
    }
    let patient_id = path.into_inner();
    match data
        .repositories
        .insurance_cards
        .get_by_owner(&patient_id)
        .await
    {
        Ok(records) => {
            // get_by_owner already returns newest-first (ts DESC) — the order
            // paginate_cursor expects.
            let (page, next_cursor) =
                paginate_cursor(&records, query.cursor.as_deref(), query.limit);
            let cards: Vec<serde_json::Value> = page.iter().map(card_json).collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "cards": cards,
                "count": cards.len(),
                "next_cursor": next_cursor,
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        }),
    }
}

/// Create an insurance card. Body must include `patient_id`.
///
/// POST /api/insurance/cards
#[post("/api/insurance/cards")]
pub async fn create_insurance_card(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    if let Err(resp) = require_auth(&req) {
        return resp;
    }
    let patient_id = match body.get("patient_id").and_then(|v| v.as_str()) {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing required field: patient_id".to_string(),
                code: "VALIDATION_ERROR".to_string(),
            })
        }
    };

    let now = Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: format!("ICARD-{}", Uuid::new_v4()),
        owner_id: patient_id,
        data: body.into_inner(),
        created_at: now,
        updated_at: now,
    };

    match data.repositories.insurance_cards.create(entity).await {
        Ok(saved) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "card": card_json(&saved),
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        }),
    }
}

/// Update an existing insurance card (full replace of the JSON body).
///
/// PUT /api/insurance/cards/{id}
#[put("/api/insurance/cards/{id}")]
pub async fn update_insurance_card(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    if let Err(resp) = require_auth(&req) {
        return resp;
    }
    let id = path.into_inner();

    // Preserve ownership + created_at from the existing record.
    let existing = match data.repositories.insurance_cards.get_by_id(&id).await {
        Ok(Some(e)) => e,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Insurance card not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: e.to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            })
        }
    };

    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: existing.owner_id,
        data: body.into_inner(),
        created_at: existing.created_at,
        updated_at: Utc::now(),
    };

    match data.repositories.insurance_cards.create(entity).await {
        Ok(saved) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "card": card_json(&saved),
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        }),
    }
}

#[derive(Debug, Deserialize)]
pub struct CardImageRequest {
    /// Base64-encoded image bytes (front/back of the card).
    pub image_base64: String,
    pub content_type: Option<String>,
}

/// Upload an insurance-card image. The image is encrypted (ChaCha20-Poly1305)
/// and stored on IPFS; the resulting hash is saved on the card as
/// `image_ipfs_hash`.
///
/// POST /api/insurance/cards/{id}/image
#[post("/api/insurance/cards/{id}/image")]
pub async fn upload_insurance_card_image(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CardImageRequest>,
) -> impl Responder {
    let uploader = match require_auth(&req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let id = path.into_inner();

    let existing = match data.repositories.insurance_cards.get_by_id(&id).await {
        Ok(Some(e)) => e,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Insurance card not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: e.to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            })
        }
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(body.image_base64.trim()) {
        Ok(b) if !b.is_empty() => b,
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "image_base64 must be non-empty base64".to_string(),
                code: "VALIDATION_ERROR".to_string(),
            })
        }
    };

    let metadata = EncryptedMetadata {
        filename: format!("insurance-card-{}", id),
        content_type: body
            .content_type
            .clone()
            .unwrap_or_else(|| "image/jpeg".to_string()),
        uploaded_at: Utc::now().timestamp(),
        patient_id: existing.owner_id.clone(),
        uploaded_by: uploader,
        record_type: "insurance_card".to_string(),
        key_version: "1.0".to_string(),
    };

    let result = match data
        .ipfs_client
        .upload_encrypted(&bytes, metadata, &data.encryption_key)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: format!("IPFS upload failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            })
        }
    };

    // Persist the IPFS hash onto the card.
    let mut new_data = existing.data.clone();
    if let Some(obj) = new_data.as_object_mut() {
        obj.insert(
            "image_ipfs_hash".to_string(),
            serde_json::json!(result.ipfs_hash),
        );
    }
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: existing.owner_id,
        data: new_data,
        created_at: existing.created_at,
        updated_at: Utc::now(),
    };
    if let Err(e) = data.repositories.insurance_cards.create(entity).await {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "image_ipfs_hash": result.ipfs_hash,
    }))
}

/// Delete an insurance card.
///
/// DELETE /api/insurance/cards/{id}
#[delete("/api/insurance/cards/{id}")]
pub async fn delete_insurance_card(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = require_auth(&req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.insurance_cards.delete(&id).await {
        Ok(()) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Insurance card deleted",
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        }),
    }
}
