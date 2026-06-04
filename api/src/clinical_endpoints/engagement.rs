//! `clinical_endpoints::engagement` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

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

    // Only primary account holder can add members
    if group.primary_account_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only primary account holder can add family members".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let relationship = match req.relationship.as_str() {
        "spouse" => crate::clinical::FamilyRelationship::Spouse,
        "child" => crate::clinical::FamilyRelationship::Child,
        "parent" => crate::clinical::FamilyRelationship::Parent,
        "sibling" => crate::clinical::FamilyRelationship::Sibling,
        "grandparent" => crate::clinical::FamilyRelationship::Grandparent,
        "grandchild" => crate::clinical::FamilyRelationship::Grandchild,
        "guardian" => crate::clinical::FamilyRelationship::Guardian,
        "dependent" => crate::clinical::FamilyRelationship::Dependent,
        _ => crate::clinical::FamilyRelationship::Other,
    };

    let access_level = match req.access_level.as_str() {
        "full" => crate::clinical::FamilyAccessLevel::Full,
        "read_only" => crate::clinical::FamilyAccessLevel::ReadOnly,
        "emergency_only" => crate::clinical::FamilyAccessLevel::EmergencyOnly,
        "appointments_only" => crate::clinical::FamilyAccessLevel::AppointmentsOnly,
        "custom" => crate::clinical::FamilyAccessLevel::Custom,
        _ => crate::clinical::FamilyAccessLevel::ReadOnly,
    };

    let member = crate::clinical::FamilyMember {
        patient_id: req.patient_id.clone(),
        relationship,
        access_level,
        can_manage_appointments: req.can_book_appointments.unwrap_or(true),
        can_view_records: req.can_view_records.unwrap_or(true),
        can_manage_medications: req.can_manage_medications.unwrap_or(false),
        can_book_appointments: req.can_book_appointments.unwrap_or(true),
        is_minor: req.is_minor.unwrap_or(false),
        linked_at: chrono::Utc::now().timestamp(),
        linked_by: current_user_id,
    };

    group.members.push(member);
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
        "message": "Family member added successfully"
    }))
}

/// Get family group details
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

    match stored {
        Some(rec) => {
            let group: crate::clinical::FamilyGroup = match serde_json::from_value(rec.data) {
                Ok(g) => g,
                Err(_) => {
                    return HttpResponse::InternalServerError().json(ErrorResponse {
                        success: false,
                        error: "Corrupt family group record".to_string(),
                        code: "INTERNAL_ERROR".to_string(),
                    })
                }
            };
            // Check if user is a member
            let is_member = group
                .members
                .iter()
                .any(|m| m.patient_id == current_user_id);
            if !is_member && group.primary_account_id != current_user_id {
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
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Family group not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}

/// Get my family groups
#[get("/api/family/my-groups")]
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

    let my_groups: Vec<crate::clinical::FamilyGroup> = data
        .repositories
        .family_groups
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::FamilyGroup>(r.data).ok())
        .filter(|g| {
            g.primary_account_id == current_user_id
                || g.members.iter().any(|m| m.patient_id == current_user_id)
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

// ============================================================================
// PHASE 23: APPOINTMENT BOOKING SYSTEM
// ============================================================================

/// Book appointment request
#[derive(Debug, Deserialize)]
pub struct BookAppointmentRequest {
    pub patient_id: String,
    pub provider_id: String,
    pub provider_name: Option<String>,
    pub appointment_type: String,
    pub preferred_date: String,
    pub preferred_time: String,
    pub scheduled_at: Option<String>,
    pub duration_minutes: Option<i32>,
    pub reason: String,
    pub notes: Option<String>,
    pub location_type: Option<String>,
    pub department: Option<String>,
    pub instructions: Option<String>,
}

/// Book an appointment
#[post("/api/appointments")]
pub async fn book_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<BookAppointmentRequest>,
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

    // Patient can book for self, provider can book for any patient
    let is_own = current_user_id == req.patient_id;
    if !is_own && !current_user.role.is_healthcare_provider() {
        // Check if booking for family member
        let all_groups: Vec<crate::clinical::FamilyGroup> = data
            .repositories
            .family_groups
            .list_all()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|r| serde_json::from_value(r.data).ok())
            .collect();
        let can_book_for_family = all_groups.iter().any(|g| {
            g.members
                .iter()
                .any(|m| m.patient_id == current_user_id && m.can_book_appointments)
                && g.members.iter().any(|m| m.patient_id == req.patient_id)
        });

        if !can_book_for_family {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Cannot book appointments for this patient".to_string(),
                code: "FORBIDDEN".to_string(),
            });
        }
    }

    // Normalize appointment_type (case-insensitive, accept hyphen/space)
    let at_norm = req.appointment_type.to_lowercase().replace(['-', ' '], "_");

    let appointment_type = match at_norm.as_str() {
        "consultation" => crate::clinical::AppointmentType::Consultation,
        "followup" | "follow_up" => crate::clinical::AppointmentType::FollowUp,
        "new_patient" => crate::clinical::AppointmentType::NewPatient,
        "procedure" => crate::clinical::AppointmentType::Procedure,
        "lab_work" => crate::clinical::AppointmentType::LabWork,
        "imaging" => crate::clinical::AppointmentType::Imaging,
        "urgent" => crate::clinical::AppointmentType::Urgent,
        "telehealth" => crate::clinical::AppointmentType::Telehealth,
        "annual_exam" => crate::clinical::AppointmentType::AnnualExam,
        "pre_op" => crate::clinical::AppointmentType::PreOp,
        "post_op" => crate::clinical::AppointmentType::PostOp,
        _ => crate::clinical::AppointmentType::Other,
    };

    let location = crate::clinical::AppointmentLocation {
        facility_name: "MediChain Health Center".to_string(),
        department: req
            .department
            .clone()
            .unwrap_or_else(|| "General".to_string()),
        room: None,
        address: Some("123 Healthcare Blvd, Medical City".to_string()),
        telehealth_link: if req.location_type.as_deref() == Some("telehealth") {
            Some(format!(
                "https://medichain.health/telehealth/{}",
                uuid::Uuid::new_v4()
            ))
        } else {
            None
        },
    };
    // Determine scheduled date and start time: prefer `scheduled_at` if provided
    let (scheduled_date, start_time) = if let Some(sched) = &req.scheduled_at {
        if let Some((d, t)) = sched.split_once('T') {
            (d.to_string(), Some(t.to_string()))
        } else {
            (sched.clone(), None)
        }
    } else {
        (req.preferred_date.clone(), Some(req.preferred_time.clone()))
    };

    // Ensure `start_time` is a concrete String (Appointment expects String)
    let start_time_str = start_time.clone().unwrap_or_default();

    let appointment = crate::clinical::Appointment {
        appointment_id: format!("APT-{}", uuid::Uuid::new_v4()),
        patient_id: req.patient_id.clone(),
        provider_id: req.provider_id.clone(),
        provider_name: req
            .provider_name
            .clone()
            .unwrap_or_else(|| "Dr. Provider".to_string()),
        appointment_type,
        visit_reason: req.reason.clone(),
        scheduled_date: scheduled_date.clone(),
        scheduled_time: Some(chrono::Utc::now().timestamp()),
        start_time: start_time_str,
        duration_minutes: req.duration_minutes.unwrap_or(30) as u16,
        location,
        status: crate::clinical::AppointmentStatus::Scheduled,
        created_at: chrono::Utc::now().timestamp(),
        updated_at: chrono::Utc::now().timestamp(),
        created_by: current_user_id.clone(),
        booked_by: Some(current_user_id),
        check_in_time: None,
        is_telehealth: req.location_type.as_deref() == Some("telehealth"),
        reminders_sent: Vec::new(),
        instructions: req.instructions.clone(),
        insurance_verified: false,
        notes: req.notes.clone(),
    };

    let appointment_id = appointment.appointment_id.clone();
    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    if let Err(e) = data.repositories.appointments.create(entity).await {
        log::error!("Appointment persistence failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to persist appointment".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "appointment_id": appointment_id,
        "message": "Appointment booked successfully"
    }))
}

/// Get appointments for a patient
#[get("/api/appointments/patient/{patient_id}")]
pub async fn get_patient_appointments(
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

    let patient_appointments: Vec<crate::clinical::Appointment> = match data
        .repositories
        .appointments
        .get_by_patient(
            &patient_id,
            crate::repositories::traits::Pagination::new(1000, 0),
        )
        .await
    {
        Ok(page) => page
            .items
            .into_iter()
            .map(crate::clinical::Appointment::from)
            .collect(),
        Err(e) => {
            log::error!("Failed to fetch patient appointments: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch appointments".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "appointments": patient_appointments,
        "count": patient_appointments.len()
    }))
}

/// Get appointments for a provider
#[get("/api/appointments/provider/{provider_id}")]
pub async fn get_provider_appointments(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let provider_id = path.into_inner();

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

    // Only the provider or admin can see provider's schedule
    if current_user_id != provider_id && !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let provider_appointments: Vec<crate::clinical::Appointment> = match data
        .repositories
        .appointments
        .get_by_provider_all(
            &provider_id,
            crate::repositories::traits::Pagination::new(1000, 0),
        )
        .await
    {
        Ok(page) => page
            .items
            .into_iter()
            .map(crate::clinical::Appointment::from)
            .collect(),
        Err(e) => {
            log::error!("Failed to fetch provider appointments: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch appointments".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "provider_id": provider_id,
        "appointments": provider_appointments,
        "count": provider_appointments.len()
    }))
}

/// Cancel appointment request
#[derive(Debug, Deserialize)]
pub struct CancelAppointmentRequest {
    pub reason: Option<String>,
}

/// Cancel an appointment
#[post("/api/appointments/{appointment_id}/cancel")]
pub async fn cancel_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<CancelAppointmentRequest>,
) -> impl Responder {
    let appointment_id = path.into_inner();

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

    let mut appointment: crate::clinical::Appointment = match data
        .repositories
        .appointments
        .get_by_id(&appointment_id)
        .await
    {
        Ok(e) => e.into(),
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Failed to fetch appointment: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch appointment".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    // Patient, provider, or booker can cancel
    if appointment.patient_id != current_user_id
        && appointment.provider_id != current_user_id
        && appointment.booked_by != Some(current_user_id.clone())
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    appointment.status = crate::clinical::AppointmentStatus::Cancelled;
    if let Some(reason) = &req.reason {
        appointment.notes = Some(format!("Cancelled: {}", reason));
    }
    appointment.updated_at = chrono::Utc::now().timestamp();

    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    if let Err(e) = data.repositories.appointments.update(entity).await {
        log::error!("Failed to persist cancellation: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to cancel appointment".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Appointment cancelled"
    }))
}

/// Check in to appointment
#[post("/api/appointments/{appointment_id}/check-in")]
pub async fn check_in_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let appointment_id = path.into_inner();

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

    let mut appointment: crate::clinical::Appointment = match data
        .repositories
        .appointments
        .get_by_id(&appointment_id)
        .await
    {
        Ok(e) => e.into(),
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Failed to fetch appointment: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch appointment".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    // Patient or staff can check in
    if appointment.patient_id != current_user_id && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    appointment.status = crate::clinical::AppointmentStatus::CheckedIn;
    appointment.check_in_time = Some(chrono::Utc::now().timestamp());
    appointment.updated_at = chrono::Utc::now().timestamp();
    let check_in_time = appointment.check_in_time;

    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    if let Err(e) = data.repositories.appointments.update(entity).await {
        log::error!("Failed to persist check-in: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to check in".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Checked in successfully",
        "check_in_time": check_in_time
    }))
}

/// Get available appointment slots
#[get("/api/appointments/slots/{provider_id}/{date}")]
pub async fn get_available_slots(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (provider_id, date) = path.into_inner();

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

    // Get booked appointments for this provider on this date
    let naive_date = match chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "date must be YYYY-MM-DD".to_string(),
                code: "BAD_DATE".to_string(),
            });
        }
    };
    let booked_entities = data
        .repositories
        .appointments
        .get_by_provider(&provider_id, naive_date)
        .await
        .unwrap_or_default();
    let booked_times: Vec<String> = booked_entities
        .into_iter()
        .map(crate::clinical::Appointment::from)
        .filter(|a| !matches!(a.status, crate::clinical::AppointmentStatus::Cancelled))
        .map(|a| a.start_time)
        .collect();

    // Generate available slots (9 AM to 5 PM, 30 min intervals)
    let all_slots = vec![
        "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
        "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
    ];

    let available_slots: Vec<&str> = all_slots
        .into_iter()
        .filter(|slot| !booked_times.contains(&slot.to_string()))
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "provider_id": provider_id,
        "date": date,
        "available_slots": available_slots,
        "slot_duration_minutes": 30
    }))
}

// ============================================================================
// PHASE 24: WEARABLE DEVICE INTEGRATION
// ============================================================================

/// Register wearable device request
#[derive(Debug, Deserialize)]
pub struct RegisterWearableRequest {
    pub device_type: String,
    pub manufacturer: String,
    pub model: String,
    pub serial_number: Option<String>,
    pub data_types: Option<Vec<String>>,
}

/// Register a wearable device
#[post("/api/wearables/devices")]
pub async fn register_wearable_device(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<RegisterWearableRequest>,
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

    let device_type = match req.device_type.as_str() {
        "smartwatch" => crate::clinical::WearableDeviceType::Smartwatch,
        "fitness_band" => crate::clinical::WearableDeviceType::FitnessBand,
        "cgm" => crate::clinical::WearableDeviceType::CGM,
        "blood_pressure" => crate::clinical::WearableDeviceType::BloodPressureMonitor,
        "pulse_oximeter" => crate::clinical::WearableDeviceType::PulseOximeter,
        "smart_scale" => crate::clinical::WearableDeviceType::SmartScale,
        "ecg" => crate::clinical::WearableDeviceType::ECGMonitor,
        "sleep_tracker" => crate::clinical::WearableDeviceType::SleepTracker,
        "glucose_meter" => crate::clinical::WearableDeviceType::GlucoseMeter,
        _ => crate::clinical::WearableDeviceType::Other,
    };

    let data_types = req
        .data_types
        .clone()
        .map(|types| {
            types
                .iter()
                .filter_map(|t| match t.as_str() {
                    "heart_rate" => Some(crate::clinical::WearableDataType::HeartRate),
                    "blood_pressure" => Some(crate::clinical::WearableDataType::BloodPressure),
                    "blood_glucose" => Some(crate::clinical::WearableDataType::BloodGlucose),
                    "spo2" => Some(crate::clinical::WearableDataType::SpO2),
                    "steps" => Some(crate::clinical::WearableDataType::Steps),
                    "distance" => Some(crate::clinical::WearableDataType::Distance),
                    "calories" => Some(crate::clinical::WearableDataType::Calories),
                    "sleep" => Some(crate::clinical::WearableDataType::Sleep),
                    "weight" => Some(crate::clinical::WearableDataType::Weight),
                    "temperature" => Some(crate::clinical::WearableDataType::Temperature),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_else(|| vec![crate::clinical::WearableDataType::HeartRate]);

    let device = crate::clinical::WearableDevice {
        device_id: format!("WRB-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id.clone(),
        device_type,
        manufacturer: req.manufacturer.clone(),
        model: req.model.clone(),
        serial_number: req.serial_number.clone(),
        firmware_version: None,
        connection_status: crate::clinical::ConnectionStatus::Connected,
        last_sync: None,
        paired_at: chrono::Utc::now().timestamp(),
        active: true,
        data_types,
        sync_frequency_hours: 1,
        battery_level: None,
    };

    let device_id = device.device_id.clone();
    {
        // Persist via repository (was: in-memory data.wearable_devices HashMap)
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: device_id.clone(),
            owner_id: device.patient_id.clone(),
            data: serde_json::to_value(&device).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data
            .repositories
            .wearable_device_records
            .create(entity)
            .await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "device_id": device_id,
        "message": "Wearable device registered successfully"
    }))
}

/// Get user's wearable devices
#[get("/api/wearables/devices")]
pub async fn get_wearable_devices(
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

    let user_devices: Vec<crate::clinical::WearableDevice> = data
        .repositories
        .wearable_device_records
        .get_by_owner(&current_user_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::WearableDevice>(r.data).ok())
        .filter(|d| d.active)
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "devices": user_devices,
        "count": user_devices.len()
    }))
}

/// Get list of supported wearable devices and their pairing instructions
#[get("/api/wearable/supported-devices")]
pub async fn get_supported_wearables(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Unauthorized".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "supported_devices": [
            {
                "type": "fitbit",
                "name": "Fitbit",
                "models": ["Charge 5", "Versa 3", "Sense 2"],
                "metrics": ["heart_rate", "steps", "sleep", "spo2"],
                "pairing_method": "oauth",
                "oauth_url": "https://www.fitbit.com/oauth2/authorize",
                "instructions": "Connect via Fitbit app authorization"
            },
            {
                "type": "apple_watch",
                "name": "Apple Watch",
                "models": ["Series 6+", "Ultra"],
                "metrics": ["heart_rate", "ecg", "blood_oxygen", "activity"],
                "pairing_method": "healthkit",
                "instructions": "Enable Health data sharing in iOS Settings > Health > Apps"
            },
            {
                "type": "samsung_galaxy_watch",
                "name": "Samsung Galaxy Watch",
                "models": ["Watch 4+", "Watch 5+"],
                "metrics": ["heart_rate", "spo2", "stress", "sleep"],
                "pairing_method": "samsung_health",
                "instructions": "Connect via Samsung Health app data sharing"
            },
            {
                "type": "garmin",
                "name": "Garmin",
                "models": ["Forerunner", "Fenix", "Vivosmart"],
                "metrics": ["heart_rate", "hrv", "activity", "sleep"],
                "pairing_method": "garmin_connect",
                "oauth_url": "https://connect.garmin.com/oauthConfirm",
                "instructions": "Connect via Garmin Connect app"
            },
            {
                "type": "withings",
                "name": "Withings",
                "models": ["ScanWatch", "BPM Connect", "Body+"],
                "metrics": ["heart_rate", "blood_pressure", "weight", "spo2"],
                "pairing_method": "oauth",
                "oauth_url": "https://account.withings.com/oauth2_user/authorize2",
                "instructions": "Authorize via Withings Health Mate"
            },
            {
                "type": "omron",
                "name": "Omron",
                "models": ["HeartGuide", "Evolv"],
                "metrics": ["blood_pressure", "heart_rate"],
                "pairing_method": "bluetooth",
                "instructions": "Pair via Bluetooth in Omron Connect app"
            },
            {
                "type": "dexcom",
                "name": "Dexcom CGM",
                "models": ["G6", "G7"],
                "metrics": ["blood_glucose", "glucose_trend"],
                "pairing_method": "oauth",
                "oauth_url": "https://api.dexcom.com/v2/oauth2/login",
                "instructions": "Connect via Dexcom Share API"
            }
        ]
    }))
}

/// Submit wearable reading request
#[derive(Debug, Deserialize)]
pub struct SubmitWearableReadingRequest {
    pub device_id: String,
    pub data_type: String,
    pub value: f64,
    pub unit: String,
    pub secondary_value: Option<f64>,
    pub recorded_at: Option<i64>,
    pub context: Option<String>,
}

/// Submit a reading from a wearable device
#[post("/api/wearables/readings")]
pub async fn submit_wearable_reading(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SubmitWearableReadingRequest>,
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

    // Verify device belongs to user (via repository)
    let device_rec = data
        .repositories
        .wearable_device_records
        .get_by_id(&req.device_id)
        .await
        .ok()
        .flatten();
    match &device_rec {
        Some(rec) => {
            let owner = rec
                .data
                .get("patient_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if owner != current_user_id {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    success: false,
                    error: "Device does not belong to you".to_string(),
                    code: "FORBIDDEN".to_string(),
                });
            }
        }
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Device not found".to_string(),
                code: "NOT_FOUND".to_string(),
            });
        }
    }

    let data_type = match req.data_type.as_str() {
        "heart_rate" => crate::clinical::WearableDataType::HeartRate,
        "blood_pressure" => crate::clinical::WearableDataType::BloodPressure,
        "blood_glucose" => crate::clinical::WearableDataType::BloodGlucose,
        "spo2" => crate::clinical::WearableDataType::SpO2,
        "steps" => crate::clinical::WearableDataType::Steps,
        "distance" => crate::clinical::WearableDataType::Distance,
        "calories" => crate::clinical::WearableDataType::Calories,
        "sleep" => crate::clinical::WearableDataType::Sleep,
        "weight" => crate::clinical::WearableDataType::Weight,
        "temperature" => crate::clinical::WearableDataType::Temperature,
        "respiratory_rate" => crate::clinical::WearableDataType::RespiratoryRate,
        "ecg" => crate::clinical::WearableDataType::ECG,
        "hrv" => crate::clinical::WearableDataType::HRV,
        "stress" => crate::clinical::WearableDataType::Stress,
        _ => crate::clinical::WearableDataType::HeartRate,
    };

    let reading_id = format!("RDG-{}", uuid::Uuid::new_v4());
    let recorded_at = req
        .recorded_at
        .unwrap_or_else(|| chrono::Utc::now().timestamp());

    // Check for abnormal values
    let (flagged, flag_reason) = check_reading_for_abnormality(&req.data_type, req.value);

    let reading = crate::clinical::WearableReading {
        reading_id: reading_id.clone(),
        device_id: req.device_id.clone(),
        patient_id: current_user_id.clone(),
        data_type: data_type.clone(),
        value: req.value,
        unit: req.unit.clone(),
        secondary_value: req.secondary_value,
        recorded_at,
        synced_at: chrono::Utc::now().timestamp(),
        context: req.context.clone(),
        quality: crate::clinical::DataQuality::High,
        flagged,
        flag_reason,
    };

    // Check alert rules (loaded from repository)
    let alert_rules: Vec<crate::clinical::WearableAlertRule> = data
        .repositories
        .wearable_alert_rules
        .get_by_owner(&current_user_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::WearableAlertRule>(r.data).ok())
        .collect();
    let mut triggered_alerts: Vec<crate::clinical::WearableAlert> = Vec::new();

    for rule in alert_rules.iter().filter(|r| r.active) {
        if rule.data_type == data_type {
            let should_alert = match rule.threshold_type {
                crate::clinical::ThresholdType::Above => req.value > rule.threshold_value,
                crate::clinical::ThresholdType::Below => req.value < rule.threshold_value,
                crate::clinical::ThresholdType::OutsideRange => {
                    if let Some(secondary) = rule.secondary_threshold {
                        req.value < rule.threshold_value || req.value > secondary
                    } else {
                        false
                    }
                }
                _ => false,
            };

            if should_alert {
                let alert = crate::clinical::WearableAlert {
                    alert_id: format!("ALT-{}", uuid::Uuid::new_v4()),
                    rule_id: rule.rule_id.clone(),
                    patient_id: current_user_id.clone(),
                    reading_id: reading_id.clone(),
                    data_type: data_type.clone(),
                    trigger_value: req.value,
                    threshold: rule.threshold_value,
                    severity: rule.severity.clone(),
                    message: format!(
                        "{:?} reading {} is abnormal (threshold: {})",
                        data_type, req.value, rule.threshold_value
                    ),
                    created_at: chrono::Utc::now().timestamp(),
                    acknowledged: false,
                    acknowledged_by: None,
                    acknowledged_at: None,
                    action_taken: None,
                };
                triggered_alerts.push(alert);
            }
        }
    }
    // Store triggered alerts via repository
    for alert in &triggered_alerts {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: alert.alert_id.clone(),
            owner_id: alert.patient_id.clone(),
            data: serde_json::to_value(alert).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data
            .repositories
            .wearable_alert_records
            .create(entity)
            .await;
    }

    // Store reading via repository
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: reading_id.clone(),
            owner_id: reading.patient_id.clone(),
            data: serde_json::to_value(&reading).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data
            .repositories
            .wearable_reading_records
            .create(entity)
            .await;
    }

    // Update device last sync via repository (fetch -> mutate -> upsert)
    if let Some(rec) = device_rec {
        if let Ok(mut device) = serde_json::from_value::<crate::clinical::WearableDevice>(rec.data)
        {
            device.last_sync = Some(chrono::Utc::now().timestamp());
            let now_dt = chrono::Utc::now();
            let entity = crate::repositories::traits::JsonRecordEntity {
                id: req.device_id.clone(),
                owner_id: device.patient_id.clone(),
                data: serde_json::to_value(&device).unwrap_or_default(),
                created_at: now_dt,
                updated_at: now_dt,
            };
            let _ = data
                .repositories
                .wearable_device_records
                .create(entity)
                .await;
        }
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "reading_id": reading_id,
        "alerts_triggered": triggered_alerts.len(),
        "alerts": triggered_alerts
    }))
}

/// Check if a reading is abnormal based on data type
fn check_reading_for_abnormality(data_type: &str, value: f64) -> (bool, Option<String>) {
    match data_type {
        "heart_rate" if value < 40.0 => (true, Some("Bradycardia detected".to_string())),
        "heart_rate" if value > 120.0 => (true, Some("Tachycardia detected".to_string())),
        "blood_glucose" if value < 70.0 => (true, Some("Hypoglycemia detected".to_string())),
        "blood_glucose" if value > 180.0 => (true, Some("Hyperglycemia detected".to_string())),
        "spo2" if value < 92.0 => (true, Some("Low oxygen saturation".to_string())),
        "temperature" if value > 38.0 => (true, Some("Fever detected".to_string())),
        _ => (false, None),
    }
}

/// Get wearable readings for a patient
#[get("/api/wearables/readings/{patient_id}")]
pub async fn get_wearable_readings(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
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

    let mut patient_readings: Vec<crate::clinical::WearableReading> = data
        .repositories
        .wearable_reading_records
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::WearableReading>(r.data).ok())
        .collect();

    // Filter by data type if specified
    if let Some(data_type) = query.get("type") {
        let target_type = match data_type.as_str() {
            "heart_rate" => Some(crate::clinical::WearableDataType::HeartRate),
            "blood_pressure" => Some(crate::clinical::WearableDataType::BloodPressure),
            "blood_glucose" => Some(crate::clinical::WearableDataType::BloodGlucose),
            "spo2" => Some(crate::clinical::WearableDataType::SpO2),
            "steps" => Some(crate::clinical::WearableDataType::Steps),
            "weight" => Some(crate::clinical::WearableDataType::Weight),
            _ => None,
        };
        if let Some(t) = target_type {
            patient_readings.retain(|r| r.data_type == t);
        }
    }

    // Sort by recorded_at descending
    patient_readings.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));

    // Limit results
    let limit = query
        .get("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(100);
    patient_readings.truncate(limit);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "readings": patient_readings,
        "count": patient_readings.len()
    }))
}

/// Create alert rule request
#[derive(Debug, Deserialize)]
pub struct CreateAlertRuleRequest {
    pub data_type: String,
    pub threshold_type: String,
    pub threshold_value: f64,
    pub secondary_threshold: Option<f64>,
    pub severity: String,
    pub notify_patient: Option<bool>,
    pub notify_provider: Option<bool>,
    pub provider_id: Option<String>,
}

/// Create a wearable alert rule
#[post("/api/wearables/alert-rules")]
pub async fn create_wearable_alert_rule(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateAlertRuleRequest>,
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

    let data_type = match req.data_type.as_str() {
        "heart_rate" => crate::clinical::WearableDataType::HeartRate,
        "blood_pressure" => crate::clinical::WearableDataType::BloodPressure,
        "blood_glucose" => crate::clinical::WearableDataType::BloodGlucose,
        "spo2" => crate::clinical::WearableDataType::SpO2,
        "steps" => crate::clinical::WearableDataType::Steps,
        "weight" => crate::clinical::WearableDataType::Weight,
        "temperature" => crate::clinical::WearableDataType::Temperature,
        _ => crate::clinical::WearableDataType::HeartRate,
    };

    let threshold_type = match req.threshold_type.as_str() {
        "above" => crate::clinical::ThresholdType::Above,
        "below" => crate::clinical::ThresholdType::Below,
        "outside_range" => crate::clinical::ThresholdType::OutsideRange,
        "change_rate" => crate::clinical::ThresholdType::ChangeRate,
        "absence" => crate::clinical::ThresholdType::AbsenceOfData,
        _ => crate::clinical::ThresholdType::Above,
    };

    let severity = match req.severity.as_str() {
        "info" => crate::clinical::AlertSeverity::Info,
        "warning" => crate::clinical::AlertSeverity::Warning,
        "urgent" => crate::clinical::AlertSeverity::Urgent,
        "critical" => crate::clinical::AlertSeverity::Critical,
        _ => crate::clinical::AlertSeverity::Warning,
    };

    let rule = crate::clinical::WearableAlertRule {
        rule_id: format!("RULE-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id.clone(),
        data_type,
        threshold_type,
        threshold_value: req.threshold_value,
        secondary_threshold: req.secondary_threshold,
        severity,
        notify_patient: req.notify_patient.unwrap_or(true),
        notify_provider: req.notify_provider.unwrap_or(false),
        provider_id: req.provider_id.clone(),
        active: true,
        created_at: chrono::Utc::now().timestamp(),
    };

    let rule_id = rule.rule_id.clone();
    {
        // Persist via repository (was: in-memory data.wearable_alert_rules HashMap)
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: rule_id.clone(),
            owner_id: rule.patient_id.clone(),
            data: serde_json::to_value(&rule).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.wearable_alert_rules.create(entity).await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "rule_id": rule_id,
        "message": "Alert rule created successfully"
    }))
}

/// Get wearable alerts
#[get("/api/wearables/alerts")]
pub async fn get_wearable_alerts(
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

    let user_alerts: Vec<crate::clinical::WearableAlert> = if current_user
        .role
        .is_healthcare_provider()
    {
        // Providers see all unacknowledged alerts
        data.repositories
            .wearable_alert_records
            .list_all()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|r| serde_json::from_value::<crate::clinical::WearableAlert>(r.data).ok())
            .filter(|a| !a.acknowledged)
            .collect()
    } else {
        // Patients see their own alerts
        data.repositories
            .wearable_alert_records
            .get_by_owner(&current_user_id)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|r| serde_json::from_value::<crate::clinical::WearableAlert>(r.data).ok())
            .collect()
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alerts": user_alerts,
        "count": user_alerts.len()
    }))
}

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
            "question": "Have you noticed any vision changes?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "nausea",
            "question": "Are you experiencing nausea or vomiting?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("fever") || symptom_lower.contains("temperature") {
        questions.push(serde_json::json!({
            "id": "temperature",
            "question": "What is your temperature (if known)?",
            "type": "number",
            "unit": "°C or °F"
        }));
        questions.push(serde_json::json!({
            "id": "chills",
            "question": "Are you experiencing chills or sweating?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("breath") || symptom_lower.contains("cough") {
        questions.push(serde_json::json!({
            "id": "productive_cough",
            "question": "Is your cough producing mucus?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "blood_mucus",
            "question": "Have you noticed any blood in the mucus?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "wheeze",
            "question": "Are you experiencing any wheezing or whistling sound when breathing?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "night_sweats",
            "question": "Have you had drenching night sweats recently?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("abdom")
        || symptom_lower.contains("stomach")
        || symptom_lower.contains("belly")
        || symptom_lower.contains("nausea")
        || symptom_lower.contains("vomit")
        || symptom_lower.contains("diarr")
    {
        questions.push(serde_json::json!({
            "id": "abdo_location",
            "question": "Where is the pain located in your abdomen?",
            "type": "choice",
            "options": ["Upper centre (epigastric)", "Upper right", "Upper left", "Lower right", "Lower left", "Around the navel", "All over / diffuse"]
        }));
        questions.push(serde_json::json!({
            "id": "abdo_character",
            "question": "How would you describe the pain?",
            "type": "choice",
            "options": ["Cramping / colicky", "Constant dull ache", "Sharp / stabbing", "Burning", "Bloating / fullness"]
        }));
        questions.push(serde_json::json!({
            "id": "nausea_vomiting",
            "question": "Are you experiencing nausea or vomiting?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "bowel_change",
            "question": "Have you noticed any change in your bowel habits (diarrhoea, constipation, or blood in stool)?",
            "type": "choice",
            "options": ["Diarrhoea", "Constipation", "Blood in stool", "Black/tarry stool", "No change"]
        }));
        questions.push(serde_json::json!({
            "id": "abdo_fever",
            "question": "Do you have a fever alongside the abdominal symptoms?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "last_meal",
            "question": "When did you last eat, and did symptoms worsen after eating?",
            "type": "choice",
            "options": ["Worse after eating", "Better after eating", "No relation to food", "Unable to eat due to pain"]
        }));
    } else if symptom_lower.contains("back pain")
        || symptom_lower.contains("back ache")
        || symptom_lower.contains("backache")
        || symptom_lower.contains("lumbar")
        || symptom_lower.contains("spine")
    {
        questions.push(serde_json::json!({
            "id": "back_location",
            "question": "Where is your back pain located?",
            "type": "choice",
            "options": ["Upper back (between shoulder blades)", "Middle back", "Lower back (lumbar)", "Tailbone / coccyx", "One side only (flank)"]
        }));
        questions.push(serde_json::json!({
            "id": "back_radiation",
            "question": "Does the pain radiate anywhere?",
            "type": "choice",
            "options": ["Down one or both legs", "Into the groin", "Into the buttocks", "Into the chest", "Does not radiate"]
        }));
        questions.push(serde_json::json!({
            "id": "back_numbness",
            "question": "Do you have any numbness, tingling, or weakness in your legs?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "back_bladder",
            "question": "Have you had any difficulty controlling your bladder or bowels?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "back_onset",
            "question": "How did the pain start?",
            "type": "choice",
            "options": ["After lifting / physical activity", "After an injury or fall", "Gradually over time", "Suddenly without cause", "After prolonged sitting / standing"]
        }));
    } else if symptom_lower.contains("rash")
        || symptom_lower.contains("skin")
        || symptom_lower.contains("itch")
        || symptom_lower.contains("hive")
        || symptom_lower.contains("blister")
    {
        questions.push(serde_json::json!({
            "id": "rash_location",
            "question": "Where is the rash or skin change?",
            "type": "choice",
            "options": ["Face / head", "Trunk (chest / abdomen / back)", "Arms", "Legs", "Hands / feet", "Widespread / all over the body"]
        }));
        questions.push(serde_json::json!({
            "id": "rash_character",
            "question": "How would you describe the rash?",
            "type": "choice",
            "options": ["Red / erythematous", "Raised bumps (urticaria / hives)", "Blisters / vesicles", "Flat spots (macules)", "Purpuric / non-blanching spots", "Scaly or flaky", "Crusting / weeping"]
        }));
        questions.push(serde_json::json!({
            "id": "rash_itch",
            "question": "Is the rash itchy, painful, or neither?",
            "type": "choice",
            "options": ["Intensely itchy", "Mildly itchy", "Painful / burning", "Neither"]
        }));
        questions.push(serde_json::json!({
            "id": "rash_fever",
            "question": "Do you have a fever with the rash?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "rash_blanch",
            "question": "Does the rash fade (turn white) when you press on it with a glass?",
            "type": "choice",
            "options": ["Yes, it fades", "No, it does not fade (non-blanching)", "Not sure"]
        }));
        questions.push(serde_json::json!({
            "id": "rash_trigger",
            "question": "Did anything precede the rash (new medication, food, insect bite, illness, soap/detergent)?",
            "type": "text"
        }));
    } else if symptom_lower.contains("joint")
        || symptom_lower.contains("arthral")
        || symptom_lower.contains("swollen joint")
        || symptom_lower.contains("knee pain")
        || symptom_lower.contains("hip pain")
        || symptom_lower.contains("ankle pain")
        || symptom_lower.contains("wrist pain")
        || symptom_lower.contains("elbow pain")
        || symptom_lower.contains("shoulder pain")
    {
        questions.push(serde_json::json!({
            "id": "joint_affected",
            "question": "Which joint(s) are affected?",
            "type": "choice",
            "options": ["Single large joint (knee / hip / shoulder)", "Multiple large joints", "Small joints of hands / feet", "Spine / back joints", "Several joints at once"]
        }));
        questions.push(serde_json::json!({
            "id": "joint_swelling",
            "question": "Is the joint visibly swollen, red, or warm to touch?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "joint_morning_stiffness",
            "question": "Is the joint stiff in the morning? If so, how long does the stiffness last?",
            "type": "choice",
            "options": ["No morning stiffness", "Less than 30 minutes", "30–60 minutes", "More than 1 hour"]
        }));
        questions.push(serde_json::json!({
            "id": "joint_trauma",
            "question": "Was there any recent injury, fall, or unusual physical activity involving that joint?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "joint_systemic",
            "question": "Do you have any other symptoms such as fever, rash, or eye redness?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("urin")
        || symptom_lower.contains("bladder")
        || symptom_lower.contains("peeing")
        || symptom_lower.contains("pee")
        || symptom_lower.contains("dysuria")
        || symptom_lower.contains("haematuria")
        || symptom_lower.contains("hematuria")
    {
        questions.push(serde_json::json!({
            "id": "urine_pain",
            "question": "Is urination painful or burning?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "urine_frequency",
            "question": "Are you urinating more frequently than usual?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "urine_colour",
            "question": "What does your urine look like?",
            "type": "choice",
            "options": ["Normal (pale yellow)", "Dark / concentrated", "Cloudy", "Pink or red (blood)", "Brown / tea-coloured", "Foamy"]
        }));
        questions.push(serde_json::json!({
            "id": "urine_fever_flank",
            "question": "Do you have fever, chills, or pain in your side / back (flank)?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "urine_incomplete",
            "question": "Do you feel that your bladder is not fully emptying after urinating?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("vision")
        || symptom_lower.contains("eye")
        || symptom_lower.contains("blurr")
        || symptom_lower.contains("sight")
        || symptom_lower.contains("visual")
    {
        questions.push(serde_json::json!({
            "id": "vision_onset",
            "question": "How did the visual change start?",
            "type": "choice",
            "options": ["Sudden (seconds to minutes)", "Gradual over hours", "Gradual over days to weeks", "Constant since birth / longstanding"]
        }));
        questions.push(serde_json::json!({
            "id": "vision_affected_eye",
            "question": "Which eye(s) are affected?",
            "type": "choice",
            "options": ["Left eye only", "Right eye only", "Both eyes", "Peripheral (side) vision loss", "Central vision loss"]
        }));
        questions.push(serde_json::json!({
            "id": "vision_character",
            "question": "How would you describe the visual problem?",
            "type": "choice",
            "options": ["Blurred / out of focus", "Double vision", "Dark curtain or shadow", "Flashing lights / floaters", "Loss of colour", "Halos around lights"]
        }));
        questions.push(serde_json::json!({
            "id": "vision_pain",
            "question": "Is there pain in or around the eye?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "vision_headache",
            "question": "Is the visual change accompanied by headache or nausea?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "vision_red_eye",
            "question": "Is the eye red or producing discharge?",
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

    // Persist the updated session (upsert preserves original created_at)
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
        "session_id": session_id,
        "triage_result": triage_result,
        "message": "Symptom assessment complete"
    }))
}

/// Calculate triage result based on symptoms and answers
fn calculate_triage_result(
    answers: &std::collections::HashMap<String, serde_json::Value>,
    symptoms: &[String],
) -> crate::clinical::TriageRecommendation {
    let severity = answers
        .get("severity")
        .and_then(|v| v.as_i64())
        .unwrap_or(5) as i32;

    let has_emergency_symptoms = symptoms.iter().any(|s| {
        let sym = s.to_lowercase();
        sym.contains("chest pain")
            || sym.contains("difficulty breathing")
            || sym.contains("stroke")
            || sym.contains("unconscious")
    });

    let chest_radiation = answers
        .get("chest_radiation")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let shortness_breath = answers
        .get("shortness_breath")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if has_emergency_symptoms || (chest_radiation && shortness_breath) || severity >= 9 {
        crate::clinical::TriageRecommendation {
            level: crate::clinical::TriageLevel::EmergencyRoom,
            explanation: "Emergency symptoms detected. Seek emergency care immediately."
                .to_string(),
            timeframe: "Immediately".to_string(),
            care_options: vec![
                crate::clinical::CareOption {
                    option_type: "emergency".to_string(),
                    description: "Call emergency services (10111 or 112)".to_string(),
                    available: true,
                    estimated_wait: Some("Immediate".to_string()),
                    cost_estimate: None,
                },
                crate::clinical::CareOption {
                    option_type: "emergency_room".to_string(),
                    description: "Go to nearest emergency room".to_string(),
                    available: true,
                    estimated_wait: None,
                    cost_estimate: None,
                },
            ],
        }
    } else if severity >= 7 || chest_radiation || shortness_breath {
        crate::clinical::TriageRecommendation {
            level: crate::clinical::TriageLevel::UrgentCare,
            explanation: "Symptoms require prompt medical evaluation within 24 hours.".to_string(),
            timeframe: "Within 24 hours".to_string(),
            care_options: vec![
                crate::clinical::CareOption {
                    option_type: "urgent_care".to_string(),
                    description: "Visit urgent care clinic".to_string(),
                    available: true,
                    estimated_wait: Some("1-2 hours".to_string()),
                    cost_estimate: None,
                },
                crate::clinical::CareOption {
                    option_type: "same_day".to_string(),
                    description: "Request same-day doctor appointment".to_string(),
                    available: true,
                    estimated_wait: None,
                    cost_estimate: None,
                },
            ],
        }
    } else if severity >= 4 {
        crate::clinical::TriageRecommendation {
            level: crate::clinical::TriageLevel::ScheduledAppointment,
            explanation: "Non-urgent symptoms. Schedule an appointment with your doctor."
                .to_string(),
            timeframe: "Within 2-3 days".to_string(),
            care_options: vec![
                crate::clinical::CareOption {
                    option_type: "appointment".to_string(),
                    description: "Schedule appointment with your primary care doctor".to_string(),
                    available: true,
                    estimated_wait: Some("2-3 days".to_string()),
                    cost_estimate: None,
                },
                crate::clinical::CareOption {
                    option_type: "telehealth".to_string(),
                    description: "Book a telehealth consultation".to_string(),
                    available: true,
                    estimated_wait: Some("Today".to_string()),
                    cost_estimate: None,
                },
            ],
        }
    } else {
        crate::clinical::TriageRecommendation {
            level: crate::clinical::TriageLevel::SelfCare,
            explanation: "Minor symptoms. Self-care and monitoring recommended.".to_string(),
            timeframe: "As needed".to_string(),
            care_options: vec![
                crate::clinical::CareOption {
                    option_type: "self_care".to_string(),
                    description: "Rest and monitor your symptoms".to_string(),
                    available: true,
                    estimated_wait: None,
                    cost_estimate: None,
                },
                crate::clinical::CareOption {
                    option_type: "pharmacy".to_string(),
                    description: "Visit pharmacy for over-the-counter remedies".to_string(),
                    available: true,
                    estimated_wait: None,
                    cost_estimate: None,
                },
            ],
        }
    }
}

/// Get symptom check session
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

    let stored = data
        .repositories
        .symptom_sessions
        .get_by_id(&session_id)
        .await
        .ok()
        .flatten();

    match stored {
        Some(rec) => {
            // Patient can see own session, provider can see any
            let owner = rec
                .data
                .get("patient_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if owner != current_user_id && !current_user.role.is_healthcare_provider() {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    success: false,
                    error: "Access denied".to_string(),
                    code: "FORBIDDEN".to_string(),
                });
            }

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "session": rec.data
            }))
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Session not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}

/// Get symptom history for a patient (Phase 25 AI Symptom Checker)
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

    let history: Vec<_> = data
        .repositories
        .symptom_sessions
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|r| r.data)
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
    let (possible_conditions, mut triage_level, mut red_flags) =
        analyze_symptom_combination(symptoms);

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
                    .push("Patient has diabetes - monitor for diabetic complications".to_string());
                if symptoms.iter().any(|s| {
                    s.to_lowercase().contains("infection") || s.to_lowercase().contains("wound")
                }) {
                    red_flags.push(
                        "Diabetic patients are at higher risk for infection complications"
                            .to_string(),
                    );
                }
            }
            if c.contains("heart") || c.contains("cardiac") {
                condition_interactions
                    .push("Patient has cardiac history - elevated cardiac risk".to_string());
                if symptoms.iter().any(|s| {
                    s.to_lowercase().contains("chest") || s.to_lowercase().contains("palpitation")
                }) && triage_level == "medium"
                {
                    triage_level = "high".to_string();
                }
            }
            if (c.contains("asthma") || c.contains("copd"))
                && symptoms.iter().any(|s| {
                    s.to_lowercase().contains("cough") || s.to_lowercase().contains("wheez")
                })
            {
                condition_interactions
                    .push("Respiratory symptoms in patient with known lung disease".to_string());
            }
            if c.contains("hypertension")
                && symptoms.iter().any(|s| {
                    s.to_lowercase().contains("headache") || s.to_lowercase().contains("dizz")
                })
            {
                condition_interactions
                    .push("Consider blood pressure check for hypertensive patient".to_string());
            }
        }
    }

    // Check for medication-related considerations
    let mut medication_warnings = Vec::new();
    if let Some(medications) = current_medications {
        for med in medications {
            let m = med.to_lowercase();
            if m.contains("warfarin") || m.contains("blood thinner") || m.contains("anticoagulant")
            {
                medication_warnings
                    .push("Patient on anticoagulants - monitor for bleeding".to_string());
                if symptoms.iter().any(|s| {
                    s.to_lowercase().contains("bleed") || s.to_lowercase().contains("bruis")
                }) {
                    red_flags.push(
                        "Bleeding symptoms in anticoagulated patient - urgent evaluation needed"
                            .to_string(),
                    );
                    if triage_level != "critical" {
                        triage_level = "high".to_string();
                    }
                }
            }
            if m.contains("insulin") || m.contains("metformin") {
                medication_warnings
                    .push("Patient on diabetes medication - check blood glucose".to_string());
            }
            if m.contains("immunosuppressant")
                || m.contains("prednisone")
                || m.contains("chemotherapy")
            {
                medication_warnings.push(
                    "Immunocompromised patient - lower threshold for infection workup".to_string(),
                );
                if symptoms.iter().any(|s| s.to_lowercase().contains("fever")) {
                    red_flags.push(
                        "Fever in immunocompromised patient requires urgent evaluation".to_string(),
                    );
                    if triage_level == "low" || triage_level == "medium" {
                        triage_level = "high".to_string();
                    }
                }
            }
        }
    }

    // Generate recommendations based on triage level
    let (triage_message, recommendations, self_care_advice, when_to_seek_care) =
        generate_triage_recommendations(&triage_level, symptoms);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "possible_conditions": possible_conditions,
        "triage_level": triage_level,
        "triage_message": triage_message,
        "recommendations": recommendations,
        "red_flags": red_flags,
        "self_care_advice": self_care_advice,
        "when_to_seek_care": when_to_seek_care,
        "patient_context": {
            "age_considerations": age_considerations,
            "gender_considerations": gender_considerations,
            "condition_interactions": condition_interactions,
            "medication_warnings": medication_warnings
        },
        "disclaimer": "This analysis is for informational purposes only and is not a medical diagnosis. Always consult a healthcare professional for proper medical advice, especially if symptoms are severe or persistent."
    }))
}

/// Analyze symptom combinations to determine possible conditions
///
/// Uses a multi-symptom scoring approach: each candidate condition accumulates
/// a score for every matching keyword/phrase found in the combined symptom
/// string.  Conditions whose score meets their activation threshold are
/// included in the output, ordered by descending score.  Emergency patterns
/// are evaluated first and short-circuit severity escalation immediately.
fn analyze_symptom_combination(
    symptoms: &[String],
) -> (Vec<PossibleConditionResult>, String, Vec<String>) {
    let mut conditions: Vec<PossibleConditionResult> = Vec::new();
    let mut red_flags: Vec<String> = Vec::new();
    // Severity order: low < medium < high < critical
    // Encoded as u8 for easy comparison.
    let severity_rank = |s: &str| match s {
        "critical" => 3u8,
        "high" => 2,
        "medium" => 1,
        _ => 0,
    };
    let mut max_severity_rank: u8 = 0;

    let symptom_str = symptoms
        .iter()
        .map(|s| s.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");

    // -------------------------------------------------------------------------
    // EMERGENCY PATTERN DETECTION (evaluated first, sets critical immediately)
    // -------------------------------------------------------------------------

    // ACS / MI: chest pain + shortness of breath + diaphoresis
    {
        let has_chest = symptom_str.contains("chest pain")
            || symptom_str.contains("crushing chest")
            || symptom_str.contains("chest pressure")
            || symptom_str.contains("chest tightness");
        let has_sob = symptom_str.contains("shortness of breath")
            || symptom_str.contains("difficulty breathing")
            || symptom_str.contains("breathless");
        let has_diaphoresis = symptom_str.contains("diaphoresis")
            || symptom_str.contains("sweating")
            || symptom_str.contains("sweat")
            || symptom_str.contains("cold sweat");
        let has_radiation = symptom_str.contains("arm pain")
            || symptom_str.contains("jaw pain")
            || symptom_str.contains("radiating")
            || symptom_str.contains("radiation");

        // Score: each matching cluster adds weight
        let mut score = 0u32;
        if has_chest {
            score += 3;
        }
        if has_sob {
            score += 2;
        }
        if has_diaphoresis {
            score += 2;
        }
        if has_radiation {
            score += 2;
        }

        if score >= 3 {
            let prob = (score as f32 * 0.12).min(0.92);
            red_flags.push("CRITICAL: Chest pain with associated symptoms – possible acute coronary syndrome. Call emergency services immediately.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Acute Coronary Syndrome / Myocardial Infarction".to_string(),
                probability: prob,
                severity: "critical".to_string(),
                description: "Combination of chest pain, dyspnoea, and/or diaphoresis is consistent with ACS/MI and requires immediate emergency evaluation.".to_string(),
                icd10_code: Some("I21.9".to_string()),
            });
        } else if has_chest {
            // Chest pain alone (no ACS cluster) – still flag as high
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            red_flags.push(
                "Chest pain can be a sign of a cardiac event – seek urgent medical evaluation."
                    .to_string(),
            );
            conditions.push(PossibleConditionResult {
                condition_name: "Chest Pain – Undifferentiated".to_string(),
                probability: 0.55,
                severity: "high".to_string(),
                description: "Chest pain requires prompt evaluation to rule out cardiac and other serious causes.".to_string(),
                icd10_code: Some("R07.9".to_string()),
            });
        }
    }

    // Stroke (FAST criteria): facial droop + arm weakness + speech difficulty
    {
        let has_face = symptom_str.contains("face droop")
            || symptom_str.contains("facial droop")
            || symptom_str.contains("face drooping")
            || symptom_str.contains("facial weakness");
        let has_arm = symptom_str.contains("arm weakness")
            || symptom_str.contains("arm numbness")
            || symptom_str.contains("limb weakness");
        let has_speech = symptom_str.contains("speech difficulty")
            || symptom_str.contains("slurred speech")
            || symptom_str.contains("speech slurred")
            || symptom_str.contains("difficulty speaking")
            || symptom_str.contains("dysarthria")
            || symptom_str.contains("aphasia");
        let has_sudden_neuro = symptom_str.contains("stroke")
            || symptom_str.contains("sudden numbness")
            || symptom_str.contains("sudden weakness");

        let mut score = 0u32;
        if has_face {
            score += 3;
        }
        if has_arm {
            score += 2;
        }
        if has_speech {
            score += 3;
        }
        if has_sudden_neuro {
            score += 2;
        }

        if score >= 3 {
            red_flags.push("STROKE WARNING (FAST): Facial droop / arm weakness / speech difficulty detected. Call emergency services immediately – time is brain.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Ischaemic Stroke".to_string(),
                probability: (score as f32 * 0.12).min(0.90),
                severity: "critical".to_string(),
                description: "FAST criteria suggest possible stroke. Immediate emergency care is essential – thrombolysis window is time-critical.".to_string(),
                icd10_code: Some("I63.9".to_string()),
            });
        }
    }

    // Meningitis / Subarachnoid Haemorrhage: sudden severe headache + neck stiffness
    {
        let has_thunderclap = symptom_str.contains("thunderclap")
            || symptom_str.contains("sudden severe headache")
            || symptom_str.contains("worst headache")
            || (symptom_str.contains("severe headache") && symptom_str.contains("sudden"));
        let has_neck = symptom_str.contains("neck stiffness")
            || symptom_str.contains("stiff neck")
            || symptom_str.contains("neck rigidity");
        let has_photophobia = symptom_str.contains("photophobia")
            || symptom_str.contains("light sensitivity")
            || symptom_str.contains("sensitive to light");
        let has_rash_petechiae = symptom_str.contains("petechiae")
            || symptom_str.contains("purpuric rash")
            || symptom_str.contains("non-blanching");

        let mut score = 0u32;
        if has_thunderclap {
            score += 4;
        }
        if has_neck {
            score += 3;
        }
        if has_photophobia {
            score += 2;
        }
        if has_rash_petechiae {
            score += 3;
        }

        if score >= 3 {
            red_flags.push("CRITICAL: Sudden severe headache with neck stiffness – possible meningitis or subarachnoid haemorrhage. Seek emergency care immediately.".to_string());
            max_severity_rank = 3;
            if has_thunderclap {
                conditions.push(PossibleConditionResult {
                    condition_name: "Subarachnoid Haemorrhage".to_string(),
                    probability: (score as f32 * 0.10).min(0.85),
                    severity: "critical".to_string(),
                    description: "Thunderclap headache ('worst headache of life') is the hallmark of SAH until proven otherwise.".to_string(),
                    icd10_code: Some("I60.9".to_string()),
                });
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Bacterial Meningitis".to_string(),
                probability: (score as f32 * 0.09).min(0.80),
                severity: "critical".to_string(),
                description:
                    "Headache, neck stiffness, and photophobia form the classic meningism triad."
                        .to_string(),
                icd10_code: Some("G03.9".to_string()),
            });
        }
    }

    // Hypertensive encephalopathy: severe headache + visual changes + hypertension
    {
        let has_severe_ha =
            symptom_str.contains("severe headache") || symptom_str.contains("worst headache");
        let has_visual = symptom_str.contains("visual change")
            || symptom_str.contains("blurred vision")
            || symptom_str.contains("vision change")
            || symptom_str.contains("visual disturbance");
        let has_htn = symptom_str.contains("hypertension")
            || symptom_str.contains("high blood pressure")
            || symptom_str.contains("elevated blood pressure");

        let mut score = 0u32;
        if has_severe_ha {
            score += 2;
        }
        if has_visual {
            score += 2;
        }
        if has_htn {
            score += 3;
        }

        if score >= 4 {
            red_flags.push("CRITICAL: Severe headache with visual changes and hypertension – possible hypertensive encephalopathy. Seek emergency care.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Hypertensive Encephalopathy".to_string(),
                probability: (score as f32 * 0.11).min(0.85),
                severity: "critical".to_string(),
                description: "End-organ hypertensive crisis affecting cerebral autoregulation. Requires immediate blood-pressure management.".to_string(),
                icd10_code: Some("I67.4".to_string()),
            });
        }
    }

    // Peritonitis / Perforation: abdominal pain + rigidity + rebound tenderness
    {
        let has_abdo = symptom_str.contains("abdominal pain")
            || symptom_str.contains("stomach pain")
            || symptom_str.contains("belly pain");
        let has_rigidity = symptom_str.contains("rigid")
            || symptom_str.contains("board-like")
            || symptom_str.contains("guarding");
        let has_rebound = symptom_str.contains("rebound")
            || symptom_str.contains("rebound tenderness")
            || symptom_str.contains("tenderness on release");

        let mut score = 0u32;
        if has_abdo {
            score += 1;
        }
        if has_rigidity {
            score += 3;
        }
        if has_rebound {
            score += 3;
        }

        if score >= 4 {
            red_flags.push("CRITICAL: Abdominal rigidity and rebound tenderness – possible peritonitis or visceral perforation. Emergency surgery may be required.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Peritonitis / Abdominal Perforation".to_string(),
                probability: (score as f32 * 0.12).min(0.88),
                severity: "critical".to_string(),
                description: "Peritoneal signs indicate possible intra-abdominal emergency requiring surgical evaluation.".to_string(),
                icd10_code: Some("K65.9".to_string()),
            });
        }
    }

    // Cholangitis (Charcot's triad): jaundice + RUQ pain + fever
    {
        let has_jaundice = symptom_str.contains("jaundice")
            || symptom_str.contains("yellow skin")
            || symptom_str.contains("yellowing");
        let has_ruq = symptom_str.contains("right upper")
            || symptom_str.contains("ruq")
            || symptom_str.contains("right upper quadrant");
        let has_fever = symptom_str.contains("fever")
            || symptom_str.contains("high temperature")
            || symptom_str.contains("pyrexia");

        let mut score = 0u32;
        if has_jaundice {
            score += 3;
        }
        if has_ruq {
            score += 2;
        }
        if has_fever {
            score += 2;
        }

        if score >= 5 {
            red_flags.push("CRITICAL: Charcot's triad (jaundice + RUQ pain + fever) – possible ascending cholangitis. Urgent biliary decompression may be needed.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Ascending Cholangitis".to_string(),
                probability: (score as f32 * 0.11).min(0.87),
                severity: "critical".to_string(),
                description: "Charcot's triad is the classic presentation of cholangitis, a biliary emergency.".to_string(),
                icd10_code: Some("K83.0".to_string()),
            });
        }
    }

    // Obstetric emergency: pregnancy + vaginal bleeding
    {
        let has_pregnancy = symptom_str.contains("pregnant")
            || symptom_str.contains("pregnancy")
            || symptom_str.contains("gravid");
        let has_bleeding = symptom_str.contains("vaginal bleeding")
            || symptom_str.contains("vaginal bleed")
            || symptom_str.contains("bleeding vaginally");

        if has_pregnancy && has_bleeding {
            red_flags.push("CRITICAL: Vaginal bleeding in pregnancy – possible ectopic pregnancy or placenta praevia. Seek emergency care immediately.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Obstetric Haemorrhage (Ectopic / Placenta Praevia)".to_string(),
                probability: 0.80,
                severity: "critical".to_string(),
                description: "Vaginal bleeding during pregnancy must be evaluated immediately to rule out life-threatening causes.".to_string(),
                icd10_code: Some("O20.9".to_string()),
            });
        }
    }

    // Altered consciousness
    {
        let has_altered = symptom_str.contains("altered consciousness")
            || symptom_str.contains("unconscious")
            || symptom_str.contains("unresponsive")
            || symptom_str.contains("loss of consciousness")
            || symptom_str.contains("confusion")
            || symptom_str.contains("disoriented")
            || symptom_str.contains("not responding");

        if has_altered {
            red_flags.push("CRITICAL: Altered level of consciousness – multiple serious causes possible. Emergency evaluation required.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Altered Consciousness – Undifferentiated".to_string(),
                probability: 0.85,
                severity: "critical".to_string(),
                description: "Reduced or altered consciousness has many serious aetiologies (hypoglycaemia, seizure, stroke, sepsis, overdose) and requires immediate assessment.".to_string(),
                icd10_code: Some("R41.3".to_string()),
            });
        }
    }

    // -------------------------------------------------------------------------
    // HIGH-ACUITY PATTERN DETECTION
    // -------------------------------------------------------------------------

    // Appendicitis: RLQ pain + nausea + fever
    {
        let has_rlq = symptom_str.contains("right lower")
            || symptom_str.contains("rlq")
            || symptom_str.contains("mcburney")
            || (symptom_str.contains("lower right")
                && (symptom_str.contains("abdominal") || symptom_str.contains("pain")));
        let has_nausea = symptom_str.contains("nausea") || symptom_str.contains("vomiting");
        let has_fever = symptom_str.contains("fever") || symptom_str.contains("temperature");

        let mut score = 0u32;
        if has_rlq {
            score += 4;
        }
        if has_nausea {
            score += 1;
        }
        if has_fever {
            score += 2;
        }
        // Also score generic abdominal pain + fever + nausea if RLQ keyword not explicit
        if !has_rlq
            && (symptom_str.contains("abdominal pain") || symptom_str.contains("stomach pain"))
            && has_fever
            && has_nausea
        {
            score += 2;
        }

        if score >= 4 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            red_flags.push("Right lower quadrant pain with fever and nausea – possible appendicitis. Seek prompt medical evaluation.".to_string());
            conditions.push(PossibleConditionResult {
                condition_name: "Appendicitis".to_string(),
                probability: (score as f32 * 0.11).min(0.82),
                severity: "high".to_string(),
                description: "Classic presentation of acute appendicitis. Requires surgical evaluation to prevent perforation.".to_string(),
                icd10_code: Some("K37".to_string()),
            });
        }
    }

    // Sepsis / septic shock: fever + circulatory/respiratory signs + confusion (qSOFA-style)
    {
        let has_fever = symptom_str.contains("fever")
            || symptom_str.contains("high temperature")
            || symptom_str.contains("chills")
            || symptom_str.contains("rigors");
        let has_tachy_hypo = symptom_str.contains("rapid heart")
            || symptom_str.contains("racing heart")
            || symptom_str.contains("palpitations")
            || symptom_str.contains("low blood pressure")
            || symptom_str.contains("hypotension")
            || symptom_str.contains("dizzy");
        let has_confusion = symptom_str.contains("confusion")
            || symptom_str.contains("altered mental")
            || symptom_str.contains("disoriented")
            || symptom_str.contains("drowsy");
        let has_rapid_breathing = symptom_str.contains("rapid breathing")
            || symptom_str.contains("fast breathing")
            || symptom_str.contains("tachypnea");

        let mut score = 0u32;
        if has_fever {
            score += 2;
        }
        if has_tachy_hypo {
            score += 2;
        }
        if has_confusion {
            score += 3;
        }
        if has_rapid_breathing {
            score += 2;
        }

        if score >= 4 {
            red_flags.push("CRITICAL: Fever with confusion and circulatory/respiratory signs – possible sepsis. Seek emergency care immediately.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Sepsis / Septic Shock".to_string(),
                probability: (score as f32 * 0.11).min(0.88),
                severity: "critical".to_string(),
                description: "Infection with signs of organ dysfunction (altered mentation, tachypnoea, hypotension) meets sepsis criteria and is time-critical.".to_string(),
                icd10_code: Some("A41.9".to_string()),
            });
        }
    }

    // Anaphylaxis: hives/swelling + airway/breathing compromise
    {
        let has_skin = symptom_str.contains("hives")
            || symptom_str.contains("urticaria")
            || symptom_str.contains("itchy rash")
            || symptom_str.contains("swelling")
            || symptom_str.contains("lip swelling")
            || symptom_str.contains("facial swelling");
        let has_airway = symptom_str.contains("throat swelling")
            || symptom_str.contains("throat tightness")
            || symptom_str.contains("difficulty swallowing")
            || symptom_str.contains("tongue swelling")
            || symptom_str.contains("hoarse");
        let has_breathing = symptom_str.contains("wheezing")
            || symptom_str.contains("shortness of breath")
            || symptom_str.contains("difficulty breathing");
        let has_trigger = symptom_str.contains("allergic")
            || symptom_str.contains("allergy")
            || symptom_str.contains("bee sting")
            || symptom_str.contains("after eating");

        let mut score = 0u32;
        if has_skin {
            score += 2;
        }
        if has_airway {
            score += 4;
        }
        if has_breathing {
            score += 3;
        }
        if has_trigger {
            score += 1;
        }

        if score >= 5 {
            red_flags.push("CRITICAL: Rapid-onset swelling/hives with breathing or throat involvement – possible anaphylaxis. Use an adrenaline auto-injector if available and call emergency services.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Anaphylaxis".to_string(),
                probability: (score as f32 * 0.11).min(0.90),
                severity: "critical".to_string(),
                description: "Acute multi-system allergic reaction with airway/respiratory compromise. Immediate adrenaline is first-line treatment.".to_string(),
                icd10_code: Some("T78.2".to_string()),
            });
        }
    }

    // Pulmonary embolism: pleuritic chest pain + dyspnoea + calf/leg swelling
    {
        let has_pleuritic = symptom_str.contains("pleuritic")
            || (symptom_str.contains("chest pain") && symptom_str.contains("breathing"));
        let has_sob = symptom_str.contains("shortness of breath")
            || symptom_str.contains("breathless")
            || symptom_str.contains("difficulty breathing");
        let has_leg = symptom_str.contains("calf pain")
            || symptom_str.contains("leg swelling")
            || symptom_str.contains("calf swelling")
            || symptom_str.contains("one leg swollen");
        let has_haemoptysis = symptom_str.contains("coughing blood")
            || symptom_str.contains("haemoptysis")
            || symptom_str.contains("hemoptysis");

        let mut score = 0u32;
        if has_pleuritic {
            score += 2;
        }
        if has_sob {
            score += 2;
        }
        if has_leg {
            score += 3;
        }
        if has_haemoptysis {
            score += 3;
        }

        if score >= 4 {
            red_flags.push("CRITICAL: Sudden dyspnoea with pleuritic chest pain and/or leg swelling – possible pulmonary embolism. Seek emergency care immediately.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Pulmonary Embolism".to_string(),
                probability: (score as f32 * 0.11).min(0.86),
                severity: "critical".to_string(),
                description: "Acute dyspnoea with pleuritic pain and DVT features suggests PE — a life-threatening but treatable emergency.".to_string(),
                icd10_code: Some("I26.99".to_string()),
            });
        }
    }

    // Diabetic ketoacidosis: polyuria + polydipsia + vomiting + altered consciousness
    {
        let has_polyuria = symptom_str.contains("excessive urination")
            || symptom_str.contains("frequent urination")
            || symptom_str.contains("polyuria");
        let has_polydipsia = symptom_str.contains("excessive thirst")
            || symptom_str.contains("very thirsty")
            || symptom_str.contains("polydipsia");
        let has_gi = symptom_str.contains("vomiting")
            || symptom_str.contains("nausea")
            || symptom_str.contains("abdominal pain");
        let has_neuro = symptom_str.contains("confusion")
            || symptom_str.contains("drowsy")
            || symptom_str.contains("fruity breath")
            || symptom_str.contains("rapid breathing");
        let has_diabetes = symptom_str.contains("diabetes")
            || symptom_str.contains("diabetic")
            || symptom_str.contains("high blood sugar");

        let mut score = 0u32;
        if has_polyuria {
            score += 2;
        }
        if has_polydipsia {
            score += 2;
        }
        if has_gi {
            score += 1;
        }
        if has_neuro {
            score += 3;
        }
        if has_diabetes {
            score += 2;
        }

        if score >= 5 {
            red_flags.push("CRITICAL: Excessive thirst/urination with vomiting and altered consciousness – possible diabetic ketoacidosis. Seek emergency care.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Diabetic Ketoacidosis".to_string(),
                probability: (score as f32 * 0.10).min(0.85),
                severity: "critical".to_string(),
                description: "Hyperglycaemic emergency with ketosis and dehydration. Requires urgent fluids and insulin.".to_string(),
                icd10_code: Some("E10.10".to_string()),
            });
        }
    }

    // Renal colic: flank pain + haematuria
    {
        let has_flank = symptom_str.contains("flank pain")
            || symptom_str.contains("flank")
            || symptom_str.contains("loin pain")
            || symptom_str.contains("loin");
        let has_haematuria = symptom_str.contains("haematuria")
            || symptom_str.contains("hematuria")
            || symptom_str.contains("blood in urine")
            || symptom_str.contains("blood in pee")
            || symptom_str.contains("bloody urine");
        let has_radiation_groin =
            symptom_str.contains("groin") || symptom_str.contains("radiating to groin");

        let mut score = 0u32;
        if has_flank {
            score += 3;
        }
        if has_haematuria {
            score += 3;
        }
        if has_radiation_groin {
            score += 2;
        }

        if score >= 3 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Renal Colic / Urolithiasis".to_string(),
                probability: (score as f32 * 0.11).min(0.83),
                severity: "high".to_string(),
                description: "Sudden onset flank pain radiating to groin with haematuria is characteristic of renal calculi.".to_string(),
                icd10_code: Some("N20.9".to_string()),
            });
        }
    }

    // Pneumonia: fever + productive cough + chest symptoms
    {
        let has_fever = symptom_str.contains("fever") || symptom_str.contains("high temperature");
        let has_productive_cough = symptom_str.contains("productive cough")
            || (symptom_str.contains("cough")
                && (symptom_str.contains("sputum")
                    || symptom_str.contains("phlegm")
                    || symptom_str.contains("mucus")));
        let has_chest_sx = symptom_str.contains("chest pain")
            || symptom_str.contains("chest tightness")
            || symptom_str.contains("pleuritic");
        let has_sob = symptom_str.contains("shortness of breath")
            || symptom_str.contains("breathless")
            || symptom_str.contains("difficulty breathing");

        let mut score = 0u32;
        if has_fever {
            score += 2;
        }
        if has_productive_cough {
            score += 3;
        }
        if has_chest_sx {
            score += 2;
        }
        if has_sob {
            score += 2;
        }

        if score >= 5 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Community-Acquired Pneumonia".to_string(),
                probability: (score as f32 * 0.09).min(0.82),
                severity: "high".to_string(),
                description: "Fever with productive cough and respiratory symptoms is consistent with pneumonia and warrants chest X-ray and antibiotic evaluation.".to_string(),
                icd10_code: Some("J18.9".to_string()),
            });
        }
    }

    // Tuberculosis: cough + fever + weight loss + night sweats
    {
        let has_cough = symptom_str.contains("cough");
        let has_fever = symptom_str.contains("fever");
        let has_weight_loss =
            symptom_str.contains("weight loss") || symptom_str.contains("losing weight");
        let has_night_sweats =
            symptom_str.contains("night sweat") || symptom_str.contains("drenching sweat");
        let has_haemoptysis = symptom_str.contains("blood in sputum")
            || symptom_str.contains("coughing blood")
            || symptom_str.contains("haemoptysis")
            || symptom_str.contains("hemoptysis");

        let mut score = 0u32;
        if has_cough {
            score += 1;
        }
        if has_fever {
            score += 1;
        }
        if has_weight_loss {
            score += 3;
        }
        if has_night_sweats {
            score += 3;
        }
        if has_haemoptysis {
            score += 3;
        }

        if score >= 5 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            red_flags.push("Chronic cough with weight loss and night sweats – consider tuberculosis screening.".to_string());
            conditions.push(PossibleConditionResult {
                condition_name: "Pulmonary Tuberculosis".to_string(),
                probability: (score as f32 * 0.09).min(0.78),
                severity: "high".to_string(),
                description: "Constitutional symptoms (weight loss, night sweats) combined with chronic cough raise concern for TB. Sputum smear, GeneXpert, and CXR recommended.".to_string(),
                icd10_code: Some("A15.9".to_string()),
            });
        }
    }

    // Dengue / viral haemorrhagic fever: rash + fever + joint pain
    {
        let has_fever = symptom_str.contains("fever") || symptom_str.contains("high temperature");
        let has_rash = symptom_str.contains("rash") || symptom_str.contains("skin rash");
        let has_joint = symptom_str.contains("joint pain")
            || symptom_str.contains("arthralgia")
            || symptom_str.contains("bone pain")
            || symptom_str.contains("myalgia")
            || symptom_str.contains("muscle pain");
        let has_retroorbital = symptom_str.contains("eye pain")
            || symptom_str.contains("retro-orbital")
            || symptom_str.contains("pain behind eyes");

        let mut score = 0u32;
        if has_fever {
            score += 2;
        }
        if has_rash {
            score += 2;
        }
        if has_joint {
            score += 2;
        }
        if has_retroorbital {
            score += 3;
        }

        if score >= 4 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Dengue / Viral Haemorrhagic Fever".to_string(),
                probability: (score as f32 * 0.10).min(0.78),
                severity: "high".to_string(),
                description: "Fever with rash and joint/muscle pain is consistent with dengue or other arboviral illness. FBC (platelet count) and dengue NS1/serology recommended.".to_string(),
                icd10_code: Some("A97.9".to_string()),
            });
        }
    }

    // -------------------------------------------------------------------------
    // MEDIUM-ACUITY AND COMMON PATTERN DETECTION
    // -------------------------------------------------------------------------

    // Migraine / severe headache
    if symptom_str.contains("headache") {
        let has_severe = symptom_str.contains("severe headache")
            || symptom_str.contains("worst headache")
            || symptom_str.contains("thunderclap");
        let has_nausea = symptom_str.contains("nausea") || symptom_str.contains("vomiting");
        let has_photophobia = symptom_str.contains("light sensitivity")
            || symptom_str.contains("photophobia")
            || symptom_str.contains("sensitive to light");
        let has_aura = symptom_str.contains("aura") || symptom_str.contains("visual aura");
        let has_fever = symptom_str.contains("fever");

        if has_fever && (has_nausea || has_photophobia) {
            // Headache + fever – already handled by meningitis block; add viral
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Viral Illness with Headache".to_string(),
                probability: 0.68,
                severity: "medium".to_string(),
                description: "Headache with fever and associated symptoms commonly indicates viral infection.".to_string(),
                icd10_code: Some("B34.9".to_string()),
            });
        } else if (has_nausea || has_photophobia) && (has_aura || has_severe) {
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Migraine".to_string(),
                probability: 0.72,
                severity: "medium".to_string(),
                description: "Unilateral throbbing headache with nausea, photophobia, or aura is classic migraine.".to_string(),
                icd10_code: Some("G43.9".to_string()),
            });
        } else if !has_severe {
            conditions.push(PossibleConditionResult {
                condition_name: "Tension-Type Headache".to_string(),
                probability: 0.62,
                severity: "low".to_string(),
                description: "Bilateral pressure-like headache often related to stress, posture, or dehydration.".to_string(),
                icd10_code: Some("G44.2".to_string()),
            });
        }
    }

    // Upper respiratory infection / influenza
    if symptom_str.contains("cough") {
        let has_fever = symptom_str.contains("fever");
        let has_fatigue = symptom_str.contains("fatigue") || symptom_str.contains("tired");
        let has_runny_nose = symptom_str.contains("runny nose")
            || symptom_str.contains("rhinorrhoea")
            || symptom_str.contains("nasal");
        let has_wheeze = symptom_str.contains("wheezing") || symptom_str.contains("wheeze");

        if has_fever && has_fatigue {
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Influenza / Upper Respiratory Infection".to_string(),
                probability: if has_runny_nose { 0.78 } else { 0.68 },
                severity: "medium".to_string(),
                description: "Acute onset of fever, cough, and fatigue is consistent with influenza or a viral URI.".to_string(),
                icd10_code: Some("J10.1".to_string()),
            });
        } else if has_runny_nose {
            conditions.push(PossibleConditionResult {
                condition_name: "Common Cold (Viral URI)".to_string(),
                probability: 0.75,
                severity: "low".to_string(),
                description: "Mild upper respiratory tract symptoms likely due to rhinovirus or similar pathogen.".to_string(),
                icd10_code: Some("J06.9".to_string()),
            });
        } else if has_wheeze {
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Asthma / Bronchospasm".to_string(),
                probability: 0.65,
                severity: "medium".to_string(),
                description: "Cough with wheeze suggests airway hyperreactivity or bronchospasm requiring evaluation.".to_string(),
                icd10_code: Some("J45.9".to_string()),
            });
        }
    }

    // Gastroenteritis / abdominal pain
    if symptom_str.contains("abdominal pain") || symptom_str.contains("stomach pain") {
        let has_nv = symptom_str.contains("nausea")
            || symptom_str.contains("vomiting")
            || symptom_str.contains("diarrhoea")
            || symptom_str.contains("diarrhea");
        let has_fever = symptom_str.contains("fever");

        if has_nv {
            conditions.push(PossibleConditionResult {
                condition_name: "Gastroenteritis".to_string(),
                probability: if has_fever { 0.68 } else { 0.72 },
                severity: "low".to_string(),
                description: "Abdominal cramps with nausea, vomiting, or diarrhoea are typical of gastroenteritis.".to_string(),
                icd10_code: Some("K52.9".to_string()),
            });
        }

        // Peptic ulcer disease
        if symptom_str.contains("burning")
            || symptom_str.contains("epigastric")
            || symptom_str.contains("heartburn")
            || symptom_str.contains("worse after eating")
            || symptom_str.contains("better after eating")
        {
            conditions.push(PossibleConditionResult {
                condition_name: "Peptic Ulcer Disease / Dyspepsia".to_string(),
                probability: 0.58,
                severity: "low".to_string(),
                description: "Epigastric burning pain related to meals may indicate PUD or GORD."
                    .to_string(),
                icd10_code: Some("K27.9".to_string()),
            });
        }
    }

    // Pharyngitis / strep throat
    if symptom_str.contains("sore throat") {
        let has_fever = symptom_str.contains("fever");
        let has_exudate = symptom_str.contains("white patch")
            || symptom_str.contains("exudate")
            || symptom_str.contains("pus");
        let has_lymph = symptom_str.contains("swollen gland")
            || symptom_str.contains("lymph node")
            || symptom_str.contains("neck swelling");

        if has_fever || has_exudate || has_lymph {
            conditions.push(PossibleConditionResult {
                condition_name: "Acute Pharyngitis / Streptococcal Tonsillitis".to_string(),
                probability: if has_exudate { 0.72 } else { 0.62 },
                severity: "low".to_string(),
                description: "Sore throat with fever, exudate, or lymphadenopathy suggests bacterial pharyngitis. Consider throat swab.".to_string(),
                icd10_code: Some("J02.0".to_string()),
            });
        } else {
            conditions.push(PossibleConditionResult {
                condition_name: "Viral Throat Irritation".to_string(),
                probability: 0.60,
                severity: "low".to_string(),
                description:
                    "Mild sore throat without fever is most often viral and self-limiting."
                        .to_string(),
                icd10_code: Some("J02.9".to_string()),
            });
        }
    }

    // Urinary tract infection
    {
        let has_dysuria = symptom_str.contains("dysuria")
            || symptom_str.contains("painful urination")
            || symptom_str.contains("burning urination")
            || symptom_str.contains("pain when urinating")
            || symptom_str.contains("pain passing urine");
        let has_frequency = symptom_str.contains("urinary frequency")
            || symptom_str.contains("frequent urination")
            || symptom_str.contains("needing to urinate")
            || symptom_str.contains("urgency");
        let has_cloudy = symptom_str.contains("cloudy urine")
            || symptom_str.contains("smelly urine")
            || symptom_str.contains("offensive urine");

        let mut score = 0u32;
        if has_dysuria {
            score += 3;
        }
        if has_frequency {
            score += 2;
        }
        if has_cloudy {
            score += 2;
        }

        if score >= 2 {
            let has_fever = symptom_str.contains("fever");
            let severity = if has_fever { "medium" } else { "low" };
            if has_fever && max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: if has_fever { "Pyelonephritis (Upper UTI)" } else { "Lower Urinary Tract Infection (Cystitis)" }.to_string(),
                probability: (score as f32 * 0.12).min(0.82),
                severity: severity.to_string(),
                description: if has_fever {
                    "UTI symptoms with fever suggest upper tract involvement (pyelonephritis) requiring urgent urine culture and antibiotics.".to_string()
                } else {
                    "Classic lower UTI/cystitis symptoms. Urine dipstick and culture recommended.".to_string()
                },
                icd10_code: Some(if has_fever { "N10" } else { "N30.0" }.to_string()),
            });
        }
    }

    // Metabolic / thyroid
    if symptom_str.contains("fatigue")
        && (symptom_str.contains("weight loss") || symptom_str.contains("weight gain"))
    {
        if max_severity_rank < 1 {
            max_severity_rank = 1;
        }
        conditions.push(PossibleConditionResult {
            condition_name: "Thyroid / Metabolic Disorder".to_string(),
            probability: 0.42,
            severity: "medium".to_string(),
            description: "Unexplained fatigue with weight change warrants thyroid function tests and metabolic workup.".to_string(),
            icd10_code: Some("E03.9".to_string()),
        });
    }

    // Anaemia
    if symptom_str.contains("fatigue")
        && (symptom_str.contains("pale")
            || symptom_str.contains("pallor")
            || symptom_str.contains("short of breath"))
    {
        conditions.push(PossibleConditionResult {
            condition_name: "Anaemia".to_string(),
            probability: 0.45,
            severity: "medium".to_string(),
            description:
                "Fatigue with pallor or exertional dyspnoea may indicate anaemia. FBC recommended."
                    .to_string(),
            icd10_code: Some("D64.9".to_string()),
        });
    }

    // Deep Vein Thrombosis / Pulmonary Embolism
    {
        let has_leg_swelling = symptom_str.contains("leg swelling")
            || symptom_str.contains("calf pain")
            || symptom_str.contains("calf swelling")
            || symptom_str.contains("swollen leg");
        let has_sob =
            symptom_str.contains("shortness of breath") || symptom_str.contains("breathless");
        let has_pleuritic = symptom_str.contains("pleuritic")
            || symptom_str.contains("sharp chest pain")
            || symptom_str.contains("pain on breathing");

        if has_leg_swelling && (has_sob || has_pleuritic) {
            max_severity_rank = 3;
            red_flags.push("Leg swelling with breathing difficulty – possible deep vein thrombosis / pulmonary embolism. Seek emergency evaluation.".to_string());
            conditions.push(PossibleConditionResult {
                condition_name: "Pulmonary Embolism / Deep Vein Thrombosis".to_string(),
                probability: 0.72,
                severity: "critical".to_string(),
                description: "DVT with sudden dyspnoea and pleuritic chest pain is the classic PE presentation.".to_string(),
                icd10_code: Some("I26.9".to_string()),
            });
        } else if has_leg_swelling {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Deep Vein Thrombosis".to_string(),
                probability: 0.50,
                severity: "high".to_string(),
                description:
                    "Unilateral calf pain and swelling warrants Doppler ultrasound to exclude DVT."
                        .to_string(),
                icd10_code: Some("I82.4".to_string()),
            });
        }
    }

    // Diabetic emergency: known diabetes + altered consciousness / extreme thirst
    {
        let has_diabetes_context = symptom_str.contains("diabetic")
            || symptom_str.contains("diabetes")
            || symptom_str.contains("insulin");
        let has_hypo = symptom_str.contains("shakiness")
            || symptom_str.contains("trembling")
            || symptom_str.contains("sweating")
            || symptom_str.contains("confusion")
            || symptom_str.contains("hypoglycaemia")
            || symptom_str.contains("hypoglycemia")
            || symptom_str.contains("low blood sugar");
        let has_polydipsia = symptom_str.contains("excessive thirst")
            || symptom_str.contains("polydipsia")
            || symptom_str.contains("frequent urination");

        if has_diabetes_context && has_hypo {
            max_severity_rank = 3;
            red_flags.push(
                "Possible hypoglycaemia in diabetic patient – check blood glucose immediately."
                    .to_string(),
            );
            conditions.push(PossibleConditionResult {
                condition_name: "Hypoglycaemia".to_string(),
                probability: 0.80,
                severity: "critical".to_string(),
                description: "Hypoglycaemic episode in known diabetic patient requires immediate glucose measurement and treatment.".to_string(),
                icd10_code: Some("E11.649".to_string()),
            });
        } else if has_polydipsia && symptom_str.contains("weight loss") {
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "New-Onset Diabetes Mellitus".to_string(),
                probability: 0.55,
                severity: "medium".to_string(),
                description: "Polyuria, polydipsia and weight loss in a non-diabetic patient raises concern for new-onset diabetes. Fasting glucose and HbA1c indicated.".to_string(),
                icd10_code: Some("E11.9".to_string()),
            });
        }
    }

    // Sort conditions: critical first, then by descending probability
    conditions.sort_by(|a, b| {
        let ra = severity_rank(&a.severity);
        let rb = severity_rank(&b.severity);
        rb.cmp(&ra).then(
            b.probability
                .partial_cmp(&a.probability)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });

    // If no conditions matched at all, return generic assessment
    if conditions.is_empty() {
        conditions.push(PossibleConditionResult {
            condition_name: "General Symptoms – Evaluation Recommended".to_string(),
            probability: 0.50,
            severity: "low".to_string(),
            description: "The reported symptoms do not match a specific high-probability pattern. A healthcare provider should evaluate you for a definitive assessment.".to_string(),
            icd10_code: None,
        });
    }

    // Map internal severity rank to API triage level string
    let triage_level = match max_severity_rank {
        3 => "emergency",
        2 => "urgent_care",
        1 => "schedule_appointment",
        _ => "self_care",
    };

    (conditions, triage_level.to_string(), red_flags)
}

/// Generate triage recommendations
fn generate_triage_recommendations(
    triage_level: &str,
    _symptoms: &[String],
) -> (String, Vec<String>, Vec<String>, Vec<String>) {
    match triage_level {
        "emergency" => (
            "Seek emergency medical care immediately".to_string(),
            vec![
                "Call emergency services (10111 or 112)".to_string(),
                "Go to the nearest emergency room".to_string(),
                "Do not drive yourself if experiencing severe symptoms".to_string(),
            ],
            vec![],
            vec![
                "Symptoms are severe or life-threatening".to_string(),
                "You experience loss of consciousness".to_string(),
            ],
        ),
        "urgent_care" => (
            "Seek medical attention within 24 hours".to_string(),
            vec![
                "Visit an urgent care clinic today".to_string(),
                "Call your doctor for same-day appointment".to_string(),
                "Consider telehealth consultation".to_string(),
            ],
            vec![
                "Rest and stay hydrated".to_string(),
                "Take over-the-counter pain relievers as directed".to_string(),
            ],
            vec![
                "Symptoms worsen significantly".to_string(),
                "You develop new concerning symptoms".to_string(),
                "Pain becomes severe".to_string(),
            ],
        ),
        "schedule_appointment" => (
            "Schedule an appointment with your doctor".to_string(),
            vec![
                "Schedule appointment within 2-3 days".to_string(),
                "Consider telehealth if in-person unavailable".to_string(),
                "Keep a symptom diary to share with your doctor".to_string(),
            ],
            vec![
                "Get plenty of rest".to_string(),
                "Stay well hydrated".to_string(),
                "Use over-the-counter remedies as appropriate".to_string(),
            ],
            vec![
                "Symptoms persist beyond a week".to_string(),
                "Symptoms significantly worsen".to_string(),
                "You develop fever above 38.5°C (101.3°F)".to_string(),
            ],
        ),
        _ => (
            "Self-care and monitoring recommended".to_string(),
            vec![
                "Monitor your symptoms".to_string(),
                "Visit a pharmacy for OTC remedies if needed".to_string(),
                "Schedule appointment if symptoms persist".to_string(),
            ],
            vec![
                "Rest and take it easy".to_string(),
                "Stay hydrated with water and clear fluids".to_string(),
                "Use appropriate over-the-counter medications".to_string(),
                "Get adequate sleep".to_string(),
            ],
            vec![
                "Symptoms do not improve after 5-7 days".to_string(),
                "Symptoms worsen instead of improving".to_string(),
                "You develop new symptoms".to_string(),
            ],
        ),
    }
}
