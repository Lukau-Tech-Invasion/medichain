use super::*;

// ============================================================================
// PHASE 22: FAMILY ACCOUNT LINKING
// ============================================================================

/// Create family group request
#[derive(Debug, Deserialize)]
pub struct CreateFamilyGroupRequest {
    pub group_name: String,
    pub primary_contact_id: String,
}

/// Create a family group
#[post("/api/family/groups")]
pub async fn create_family_group(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateFamilyGroupRequest>,
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

    // Only the primary contact can create their family group
    if current_user_id != req.primary_contact_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You can only create a family group for yourself".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let group = crate::clinical::FamilyGroup {
        family_id: format!("FAM-{}", uuid::Uuid::new_v4()),
        family_name: req.group_name.clone(),
        primary_account_id: req.primary_contact_id.clone(),
        members: vec![crate::clinical::FamilyMember {
            patient_id: req.primary_contact_id.clone(),
            relationship: crate::clinical::FamilyRelationship::Self_,
            access_level: crate::clinical::FamilyAccessLevel::Full,
            can_manage_appointments: true,
            can_view_records: true,
            can_manage_medications: true,
            can_book_appointments: true,
            is_minor: false,
            linked_at: chrono::Utc::now().timestamp(),
            linked_by: current_user_id.clone(),
        }],
        created_at: chrono::Utc::now().timestamp(),
        last_modified: chrono::Utc::now().timestamp(),
    };

    let group_id = group.family_id.clone();
    {
        // Persist via repository (was: in-memory data.family_groups HashMap)
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: group_id.clone(),
            owner_id: group.primary_account_id.clone(),
            data: serde_json::to_value(&group).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.family_groups.create(entity).await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "group_id": group_id,
        "message": "Family group created successfully"
    }))
}

/// Add family member request
#[derive(Debug, Deserialize)]
pub struct AddFamilyMemberRequest {
    pub patient_id: String,
    pub relationship: String,
    pub access_level: String,
    pub can_book_appointments: Option<bool>,
    pub can_view_records: Option<bool>,
    pub can_manage_medications: Option<bool>,
    pub is_minor: Option<bool>,
}

/// Add a member to family group
#[post("/api/family/groups/{group_id}/members")]
pub async fn add_family_member(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<AddFamilyMemberRequest>,
) -> impl Responder {
    let group_id = path.into_inner();

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
        .family_groups
        .get_by_id(&group_id)
        .await
        .ok()
        .flatten();
    let mut group: crate::clinical::FamilyGroup = match stored {
        Some(rec) => match serde_json::from_value(rec.data) {
            Ok(g) => g,
            Err(_) => {
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Corrupt family group record".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                })
            }
        },
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Family group not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only primary contact can add members
    if group.primary_account_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the primary contact can add members".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Check if patient already in group
    if group.members.iter().any(|m| m.patient_id == req.patient_id) {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "Patient already a member of this group".to_string(),
            code: "CONFLICT".to_string(),
        });
    }

    let rel = match req.relationship.as_str() {
        "Spouse" => crate::clinical::FamilyRelationship::Spouse,
        "Child" => crate::clinical::FamilyRelationship::Child,
        "Parent" => crate::clinical::FamilyRelationship::Parent,
        "Sibling" => crate::clinical::FamilyRelationship::Sibling,
        _ => crate::clinical::FamilyRelationship::Other,
    };

    let level = match req.access_level.as_str() {
        "Full" => crate::clinical::FamilyAccessLevel::Full,
        "ViewOnly" => crate::clinical::FamilyAccessLevel::ReadOnly,
        "Limited" => crate::clinical::FamilyAccessLevel::Custom,
        "AppointmentsOnly" => crate::clinical::FamilyAccessLevel::AppointmentsOnly,
        "EmergencyOnly" => crate::clinical::FamilyAccessLevel::EmergencyOnly,
        _ => crate::clinical::FamilyAccessLevel::ReadOnly,
    };

    group.members.push(crate::clinical::FamilyMember {
        patient_id: req.patient_id.clone(),
        relationship: rel,
        access_level: level,
        can_manage_appointments: req.can_book_appointments.unwrap_or(false),
        can_view_records: req.can_view_records.unwrap_or(false),
        can_manage_medications: req.can_manage_medications.unwrap_or(false),
        can_book_appointments: req.can_book_appointments.unwrap_or(false),
        is_minor: req.is_minor.unwrap_or(false),
        linked_at: chrono::Utc::now().timestamp(),
        linked_by: current_user_id.clone(),
    });
    group.last_modified = chrono::Utc::now().timestamp();

    // Persist the updated group
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: group_id.clone(),
            owner_id: group.primary_account_id.clone(),
            data: serde_json::to_value(&group).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.family_groups.create(entity).await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Family member added"
    }))
}

/// Get family group
#[get("/api/family/groups/{group_id}")]
pub async fn get_family_group(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let group_id = path.into_inner();

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
        .family_groups
        .get_by_id(&group_id)
        .await
        .ok()
        .flatten();
    let group: crate::clinical::FamilyGroup = match stored {
        Some(rec) => match serde_json::from_value(rec.data) {
            Ok(g) => g,
            Err(_) => {
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Corrupt family group record".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                })
            }
        },
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Family group not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Check if requester is a member of the group
    if !group
        .members
        .iter()
        .any(|m| m.patient_id == current_user_id)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "group": group
    }))
}

/// Get my family groups
#[get("/api/family/groups")]
pub async fn get_my_family_groups(
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

    // Repository list_all() (was: data.family_groups HashMap)
    let all_records = data
        .repositories
        .family_groups
        .list_all()
        .await
        .unwrap_or_default();
    let my_groups: Vec<crate::clinical::FamilyGroup> = all_records
        .into_iter()
        .filter_map(|rec| {
            let g: crate::clinical::FamilyGroup = serde_json::from_value(rec.data).ok()?;
            if g.members.iter().any(|m| m.patient_id == current_user_id) {
                Some(g)
            } else {
                None
            }
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "groups": my_groups,
        "count": my_groups.len()
    }))
}

/// Remove family member
#[delete("/api/family/groups/{group_id}/members/{patient_id}")]
pub async fn remove_family_member(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (group_id, patient_id) = path.into_inner();

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
        .family_groups
        .get_by_id(&group_id)
        .await
        .ok()
        .flatten();
    let mut group: crate::clinical::FamilyGroup = match stored {
        Some(rec) => match serde_json::from_value(rec.data) {
            Ok(g) => g,
            Err(_) => {
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Corrupt family group record".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                })
            }
        },
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Family group not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only primary contact can remove members (or member removing themselves)
    if group.primary_account_id != current_user_id && patient_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Can't remove primary contact
    if patient_id == group.primary_account_id {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Cannot remove primary contact from group".to_string(),
            code: "BAD_REQUEST".to_string(),
        });
    }

    group.members.retain(|m| m.patient_id != patient_id);
    group.last_modified = chrono::Utc::now().timestamp();

    // Persist the updated group (upsert preserves original created_at)
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: group_id.clone(),
            owner_id: group.primary_account_id.clone(),
            data: serde_json::to_value(&group).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.family_groups.create(entity).await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Family member removed"
    }))
}
