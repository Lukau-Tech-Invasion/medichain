//! `clinical_endpoints::medical_id::preferences` — Medical ID preference updates +
//! emergency notification trigger.
//!
//! Split out of the former single-file `medical_id.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `medical_id/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Update Medical ID preferences
#[post("/api/medical-id/{patient_id}/preferences")]
pub async fn update_medical_id_preferences(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient themselves or admin can update preferences
    let is_patient =
        crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);
    let is_admin = matches!(current_user.role, crate::Role::Admin);

    if !is_patient && !is_admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only patient or admin can update preferences".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Via repository (was: in-memory data.patients HashMap); decrypt → mutate → persist.
    let entity = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(e) => e,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };
    let mut patient = match crate::patient_entity_to_profile(&entity, &data.encryption_keyring) {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Update preferences
    if let Some(show_when_locked) = body.get("show_when_locked").and_then(|v| v.as_bool()) {
        patient.preferences.show_when_locked = show_when_locked;
    }
    if let Some(enable_location) = body
        .get("enable_location_sharing")
        .and_then(|v| v.as_bool())
    {
        patient.preferences.enable_location_sharing = enable_location;
    }
    if let Some(auto_notify) = body.get("auto_notify_family").and_then(|v| v.as_bool()) {
        patient.preferences.auto_notify_family = auto_notify;
    }
    if let Some(language) = body.get("display_language").and_then(|v| v.as_str()) {
        patient.preferences.display_language = Some(language.to_string());
    }

    patient.last_updated = chrono::Utc::now();

    // Persist via repository, preserving entity-only fields not in PatientProfile.
    let mut updated_entity = crate::patient_profile_to_entity(&patient, &data.encryption_keyring);
    updated_entity.health_id = entity.health_id.clone();
    updated_entity.gender = entity.gender.clone();
    updated_entity.wallet_address = entity.wallet_address.clone();
    updated_entity.is_verified = entity.is_verified;
    updated_entity.registered_by = entity.registered_by.clone();
    updated_entity.primary_provider_id = entity.primary_provider_id.clone();
    updated_entity.created_at = entity.created_at;
    if let Err(error) = data.repositories.patients.update(updated_entity).await {
        log::error!("Medical ID preference persistence failed: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Medical ID preferences could not be saved".to_string(),
            code: "STORAGE_UNAVAILABLE".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "preferences": patient.preferences,
        "message": "Medical ID preferences updated"
    }))
}

/// Trigger emergency notification to family
#[post("/api/medical-id/{patient_id}/emergency-notify")]
pub async fn trigger_emergency_notification(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient or healthcare providers can trigger
    let is_patient =
        crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);
    let is_provider = current_user.role.is_healthcare_provider();

    if !is_patient && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // This endpoint used to send nothing at all. The consent gate was written
    // as `if false`, the recipient list was `Vec::new()`, and it then returned
    // `success: true` with "Emergency notification queued for 0 contacts" —
    // so the caller, in an emergency, was told the family had been contacted
    // when no message had been composed, let alone delivered.
    let profile = match crate::patient_entity_to_profile(&patient, &data.encryption_keyring) {
        Some(profile) => profile,
        None => {
            log::error!("emergency notify {patient_id}: profile could not be decrypted");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Emergency contacts could not be read, so no notification was sent."
                    .to_string(),
                code: "CONTACTS_UNAVAILABLE".to_string(),
            });
        }
    };

    // The patient's own opt-out is now actually honoured.
    if !profile.preferences.auto_notify_family {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Family notifications are disabled for this patient".to_string(),
            code: "NOTIFICATIONS_DISABLED".to_string(),
        });
    }

    let location = body.get("location").and_then(|l| l.as_str());
    let custom_message = body.get("message").and_then(|m| m.as_str());
    let emergency_type = body
        .get("emergency_type")
        .and_then(|e| e.as_str())
        .unwrap_or("medical");

    let contacts = &profile.emergency_info.emergency_contacts;
    if contacts.is_empty() {
        // Distinct from success-with-zero: the caller must know nobody was
        // reachable so they can find another way.
        return HttpResponse::UnprocessableEntity().json(ErrorResponse {
            success: false,
            error: "No emergency contacts are recorded for this patient; nobody was notified."
                .to_string(),
            code: "NO_EMERGENCY_CONTACTS".to_string(),
        });
    }

    let body_text = match (custom_message, location) {
        (Some(message), Some(place)) => format!(
            "MediChain emergency alert for {}: {} (reported near {}). Contact emergency services.",
            profile.full_name, message, place
        ),
        (Some(message), None) => format!(
            "MediChain emergency alert for {}: {}. Contact emergency services.",
            profile.full_name, message
        ),
        (None, Some(place)) => format!(
            "MediChain emergency alert: {} is involved in a {} emergency near {}. \
             Contact emergency services.",
            profile.full_name, emergency_type, place
        ),
        (None, None) => format!(
            "MediChain emergency alert: {} is involved in a {} emergency. \
             Contact emergency services.",
            profile.full_name, emergency_type
        ),
    };

    // Delivered through the same retrying, opt-out-aware path as every other
    // SMS. Each contact's real outcome is reported rather than assumed.
    let mut notifications: Vec<serde_json::Value> = Vec::with_capacity(contacts.len());
    let mut delivered = 0usize;
    for contact in contacts {
        let status = crate::notifications::send_sms_with_retry(
            &data.repositories,
            crate::notifications::SmsMessage {
                to: contact.phone.clone(),
                body: body_text.clone(),
            },
            true,
        )
        .await;
        let status_label = match status {
            crate::notifications::SmsDeliveryStatus::Sent => {
                delivered += 1;
                "sent"
            }
            crate::notifications::SmsDeliveryStatus::Suppressed => "suppressed",
            crate::notifications::SmsDeliveryStatus::Failed => "failed",
        };
        notifications.push(serde_json::json!({
            "name": contact.name,
            "phone": contact.phone,
            "relationship": contact.relationship,
            "status": status_label
        }));
    }

    // Log emergency notification
    let log_entry = crate::repositories::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        patient_id: Some(patient_id.clone()),
        resource_type: "emergency_notification".to_string(),
        resource_id: Some(patient_id.clone()),
        action: "create".to_string(),
        access_reason: Some(format!("Emergency {} notification", emergency_type)),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
    };
    let _ = data.repositories.access_logs.create(log_entry).await;

    // `success` reflects whether anyone was actually reached, and
    // `notifications_sent` counts deliveries rather than attempts — the old
    // version reported the length of an empty list as though it were a result.
    let attempted = notifications.len();
    let mut status = if delivered > 0 {
        HttpResponse::Ok()
    } else {
        HttpResponse::ServiceUnavailable()
    };
    status.json(serde_json::json!({
        "success": delivered > 0,
        "patient_id": patient_id,
        "notifications_sent": delivered,
        "notifications_attempted": attempted,
        "notifications": notifications,
        "message": format!(
            "Emergency notification delivered to {delivered} of {attempted} contacts"
        )
    }))
}

#[cfg(test)]
mod tests {
    use super::dnr_is_verified;
    use chrono::Utc;

    #[test]
    fn dnr_unverified_when_metadata_missing() {
        // status set, but no verifier/timestamp → NOT authoritative.
        assert!(!dnr_is_verified(true, &None, &None));
        // status set, only verified_by present → still NOT authoritative.
        assert!(!dnr_is_verified(true, &Some("doc-1".to_string()), &None));
        // status set, only verified_at present → still NOT authoritative.
        assert!(!dnr_is_verified(true, &None, &Some(Utc::now())));
    }

    #[test]
    fn dnr_verified_when_status_and_metadata_present() {
        assert!(dnr_is_verified(
            true,
            &Some("doc-1".to_string()),
            &Some(Utc::now())
        ));
    }

    #[test]
    fn dnr_not_verified_when_status_false_even_with_metadata() {
        // Defensive: no DNR on file means it can never read as a verified directive.
        assert!(!dnr_is_verified(
            false,
            &Some("doc-1".to_string()),
            &Some(Utc::now())
        ));
    }
}
