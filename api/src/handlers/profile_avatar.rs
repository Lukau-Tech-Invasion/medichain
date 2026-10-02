use super::*;

// ============================================================================
// Staff profile picture
// ============================================================================

/// The largest avatar accepted, in bytes of the encoded `data:` URI.
///
/// A ceiling rather than a preference: every response that embeds a profile
/// picture pays for it, and a clinician who uploads a 4 MB photograph would
/// slow down every list their name appears in. 256 KB is a generous square
/// portrait.
const AVATAR_MAX_BYTES: usize = 256 * 1024;

/// The media types a browser will actually render inline, and that carry no
/// script. SVG is excluded on purpose: it is a document that can carry script,
/// and an avatar is displayed in other people's sessions.
const AVATAR_MEDIA_TYPES: [&str; 4] = [
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/webp;base64,",
    "data:image/gif;base64,",
];

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAvatarRequest {
    /// The image as a `data:` URI. Absent or empty removes the picture.
    #[serde(default)]
    pub avatar: Option<String>,
}

/// Set or clear the signed-in clinician's profile picture.
///
/// Caller-scoped: a clinician changes their own picture, and an administrator
/// changing somebody else's face is not a workflow this system has.
#[post("/api/users/me/avatar")]
pub async fn set_my_avatar(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SetAvatarRequest>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let now = chrono::Utc::now();
    let account_id = caller.id.clone();

    let submitted = req
        .into_inner()
        .avatar
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let Some(avatar) = submitted else {
        // Clearing is a write of an empty record, not a delete: the row is the
        // clinician's avatar setting, and "I removed my picture" is a state.
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: format!("AVA-{account_id}"),
            owner_id: account_id.clone(),
            data: serde_json::json!({ "avatar": serde_json::Value::Null, "updatedAt": now.to_rfc3339() }),
            created_at: now,
            updated_at: now,
        };
        return match data.repositories.user_avatars.create(entity).await {
            Ok(_) => HttpResponse::Ok()
                .json(serde_json::json!({ "success": true, "avatar": serde_json::Value::Null })),
            Err(e) => {
                log::error!("avatar clear failed: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    error: "Your profile picture could not be updated".to_string(),
                    code: "DATABASE_ERROR".to_string(),
                })
            }
        };
    };

    if !AVATAR_MEDIA_TYPES
        .iter()
        .any(|prefix| avatar.starts_with(prefix))
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "A profile picture must be a PNG, JPEG, WebP or GIF data URI".to_string(),
            code: "UNSUPPORTED_MEDIA_TYPE".to_string(),
        });
    }
    if avatar.len() > AVATAR_MAX_BYTES {
        return HttpResponse::PayloadTooLarge().json(ErrorResponse {
            error: "That image is too large; please use one under 256 KB".to_string(),
            code: "AVATAR_TOO_LARGE".to_string(),
        });
    }

    let entity = crate::repositories::traits::JsonRecordEntity {
        // Deterministic id: one avatar per clinician, and a retry replaces
        // rather than accumulating a row per upload.
        id: format!("AVA-{account_id}"),
        owner_id: account_id.clone(),
        data: serde_json::json!({
            "avatar": avatar,
            "updatedAt": now.to_rfc3339(),
        }),
        created_at: now,
        updated_at: now,
    };

    match data.repositories.user_avatars.create(entity).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "updatedAt": now.to_rfc3339(),
        })),
        Err(e) => {
            log::error!("avatar upload failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Your profile picture could not be saved".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// One clinician's profile picture.
///
/// Readable by any signed-in caller, because this is the picture shown beside
/// their name on records they authored — an avatar nobody else can load is a
/// picture of nothing.
#[get("/api/users/{user_id}/avatar")]
pub async fn get_user_avatar(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_registered_caller(&data, &http_req) {
        return resp;
    }
    let user_id = path.into_inner();

    match data.repositories.user_avatars.get_by_owner(&user_id).await {
        Ok(rows) => {
            let avatar = rows
                .into_iter()
                .next()
                .and_then(|r| r.data.get("avatar").cloned())
                .unwrap_or(serde_json::Value::Null);
            HttpResponse::Ok().json(serde_json::json!({ "success": true, "avatar": avatar }))
        }
        Err(e) => {
            log::error!("avatar read failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "The profile picture could not be read".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}
