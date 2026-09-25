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
            error: "Authentication required".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })
    })
}

/// Fetch a card by id and confirm the caller may act on it: the card's owner, or
/// a healthcare provider. Otherwise the appropriate error response.
///
/// HZ-020 (resource-id IDOR): the card mutators previously gated on `require_auth`
/// only — any authenticated account could update, image, or delete another
/// patient's card by its id. This applies owner-or-provider after fetching the
/// resource, centralised for the three mutators.
async fn require_card_access(
    data: &web::Data<AppState>,
    caller: &str,
    card_id: &str,
) -> Result<crate::repositories::traits::JsonRecordEntity, HttpResponse> {
    let existing = match data.repositories.insurance_cards.get_by_id(card_id).await {
        Ok(Some(e)) => e,
        Ok(None) => {
            return Err(HttpResponse::NotFound().json(ErrorResponse {
                error: "Insurance card not found".to_string(),
                code: "NOT_FOUND".to_string(),
            }))
        }
        Err(e) => {
            return Err(HttpResponse::InternalServerError().json(ErrorResponse {
                error: e.to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            }))
        }
    };
    let is_provider = get_user(data, caller)
        .map(|u| u.role.is_healthcare_provider())
        .unwrap_or(false);
    if !is_provider && existing.owner_id != caller {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        }));
    }
    Ok(existing)
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

    // HZ-019 IDOR follow-up: require_auth only proves the caller is authenticated,
    // not that they own these cards. Without this an unrelated patient could list
    // another patient's insurance cards. Apply provider-or-self.
    if let Some(uid) = get_current_user_id(&req) {
        let is_provider = get_user(&data, &uid)
            .map(|u| u.role.is_healthcare_provider())
            .unwrap_or(false);
        if !is_provider && uid != patient_id {
            return HttpResponse::Forbidden().json(ErrorResponse {
                error: "Access denied".to_string(),
                code: "ACCESS_DENIED".to_string(),
            });
        }
    }

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
    let caller_id = match require_auth(&req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let patient_id = match body.get("patient_id").and_then(|v| v.as_str()) {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "Missing required field: patient_id".to_string(),
                code: "VALIDATION_ERROR".to_string(),
            })
        }
    };

    // HZ-020 covered the card MUTATORS (update/image/delete) but not create, so
    // any authenticated caller could file an insurance card against any
    // patient's record. Creation needs the same owner-or-provider rule the
    // mutators got: `require_auth` only proves a header was sent.
    let caller = match get_user(&data, &caller_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    let is_self =
        caller.linked_patient_id.as_deref() == Some(patient_id.as_str()) || caller_id == patient_id;
    if !is_self && !caller.role.is_healthcare_provider() && !caller.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "You may not create an insurance card for this patient".to_string(),
            code: "ACCESS_FORBIDDEN".to_string(),
        });
    }

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
    let caller = match require_auth(&req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let id = path.into_inner();

    // HZ-020: owner-or-provider check (was require_auth only). Also preserves
    // ownership + created_at from the existing record.
    let existing = match require_card_access(&data, &caller, &id).await {
        Ok(e) => e,
        Err(resp) => return resp,
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
    pub side: CardImageSide,
}

/// A card side is part of the persistent record identity, not a presentation hint.
#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum CardImageSide {
    Front,
    Back,
}

impl CardImageSide {
    fn field_name(self) -> &'static str {
        match self {
            Self::Front => "front_image",
            Self::Back => "back_image",
        }
    }
}

/// The two hashes are inseparable: encrypted content cannot be opened without
/// the separately encrypted metadata object that identifies its key version.
#[derive(Debug, Deserialize, Serialize)]
struct StoredCardImage {
    content_hash: String,
    metadata_hash: String,
    content_type: String,
}

/// Upload an insurance-card image. The image is encrypted (ChaCha20-Poly1305)
/// and stored on IPFS with its metadata hash under the named card side.
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

    // HZ-020: owner-or-provider check (was require_auth only).
    let existing = match require_card_access(&data, &uploader, &id).await {
        Ok(e) => e,
        Err(resp) => return resp,
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(body.image_base64.trim()) {
        Ok(b) if !b.is_empty() => b,
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "image_base64 must be non-empty base64".to_string(),
                code: "VALIDATION_ERROR".to_string(),
            })
        }
    };

    let content_type = body
        .content_type
        .clone()
        .unwrap_or_else(|| "image/jpeg".to_string());
    if !content_type.starts_with("image/") {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "content_type must be an image type".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    let metadata = EncryptedMetadata {
        filename: format!("insurance-card-{}", id),
        content_type: content_type.clone(),
        uploaded_at: Utc::now().timestamp(),
        patient_id: existing.owner_id.clone(),
        uploaded_by: uploader,
        record_type: "insurance_card".to_string(),
        key_version: "1.0".to_string(),
    };

    let result = match data
        .ipfs_client
        .upload_encrypted(&bytes, metadata, &data.encryption_keyring)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: format!("IPFS upload failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            })
        }
    };

    // Persist the complete, side-specific encrypted reference. A content hash
    // alone is unreadable because metadata carries the encryption version.
    let mut new_data = existing.data.clone();
    if let Some(obj) = new_data.as_object_mut() {
        obj.insert(
            body.side.field_name().to_string(),
            serde_json::json!(StoredCardImage {
                content_hash: result.ipfs_hash.clone(),
                metadata_hash: result.metadata_hash.clone(),
                content_type: content_type.clone(),
            }),
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
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "image_ipfs_hash": result.ipfs_hash,
        "metadata_ipfs_hash": result.metadata_hash,
        "side": body.side,
    }))
}

/// Decrypt one stored insurance-card image after the same owner-or-provider
/// authorization applied to upload, replacement, and deletion.
#[get("/api/insurance/cards/{id}/image/{side}")]
pub async fn download_insurance_card_image(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<(String, CardImageSide)>,
) -> impl Responder {
    let caller = match require_auth(&req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let (id, side) = path.into_inner();
    let card = match require_card_access(&data, &caller, &id).await {
        Ok(card) => card,
        Err(resp) => return resp,
    };
    let image = card
        .data
        .get(side.field_name())
        .cloned()
        .and_then(|value| serde_json::from_value::<StoredCardImage>(value).ok());
    let Some(image) = image else {
        return HttpResponse::NotFound().json(ErrorResponse {
            error: "Insurance card image not found".to_string(),
            code: "NOT_FOUND".to_string(),
        });
    };
    let result = match data
        .ipfs_client
        .download_decrypted(
            &image.content_hash,
            &image.metadata_hash,
            &data.encryption_keyring,
        )
        .await
    {
        Ok(result) => result,
        Err(error) => {
            log::error!("insurance card image download failed: {error}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Insurance card image could not be read".to_string(),
                code: "IMAGE_UNAVAILABLE".to_string(),
            });
        }
    };
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "content_base64": base64::engine::general_purpose::STANDARD.encode(result.content),
        "content_type": result.metadata.content_type,
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
    let caller = match require_auth(&req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let id = path.into_inner();

    // HZ-020: previously delete gated on require_auth only and did not even
    // fetch the card, so any authenticated account could delete anyone's card
    // by id. Confirm owner-or-provider first.
    if let Err(resp) = require_card_access(&data, &caller, &id).await {
        return resp;
    }

    match data.repositories.insurance_cards.delete(&id).await {
        Ok(()) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Insurance card deleted",
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        }),
    }
}
