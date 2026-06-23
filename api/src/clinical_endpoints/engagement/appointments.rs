use super::*;

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

    // User must be booking for themselves or be a healthcare provider/authorized relative
    if current_user_id != req.patient_id {
        // Simple role check for demo (ideally uses pallets/access-control)
        let is_provider = current_user_id.starts_with("0xPROV");
        if !is_provider {
            // Check family access (Phase 22 linkage)
            let stored_groups = data
                .repositories
                .family_groups
                .list_all()
                .await
                .unwrap_or_default();
            let has_family_access = stored_groups.into_iter().any(|rec| {
                if let Ok(g) = serde_json::from_value::<crate::clinical::FamilyGroup>(rec.data) {
                    g.members.iter().any(|m| {
                        m.patient_id == current_user_id
                            && g.members.iter().any(|m2| m2.patient_id == req.patient_id)
                            && m.can_book_appointments
                    })
                } else {
                    false
                }
            });

            if !has_family_access {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    success: false,
                    error: "Unauthorized to book appointment for this patient".to_string(),
                    code: "FORBIDDEN".to_string(),
                });
            }
        }
    }

    let appointment_type = match req.appointment_type.as_str() {
        "Routine" => crate::clinical::AppointmentType::FollowUp,
        "FollowUp" => crate::clinical::AppointmentType::FollowUp,
        "Emergency" => crate::clinical::AppointmentType::Urgent,
        "SpecialistConsultation" => crate::clinical::AppointmentType::Consultation,
        "LabWork" => crate::clinical::AppointmentType::LabWork,
        "Vaccination" => crate::clinical::AppointmentType::Other,
        "SurgeryPreOp" => crate::clinical::AppointmentType::PreOp,
        "Telehealth" => crate::clinical::AppointmentType::Telehealth,
        _ => crate::clinical::AppointmentType::FollowUp,
    };
    let duration_minutes = req
        .duration_minutes
        .and_then(|minutes| u16::try_from(minutes).ok())
        .unwrap_or(30);
    let scheduled_time = req
        .scheduled_at
        .as_ref()
        .and_then(|value| value.parse::<i64>().ok());
    let is_telehealth = matches!(
        appointment_type,
        crate::clinical::AppointmentType::Telehealth
    ) || req.location_type.as_deref() == Some("Telehealth");

    let appointment = crate::clinical::Appointment {
        appointment_id: format!("APT-{}", uuid::Uuid::new_v4()),
        patient_id: req.patient_id.clone(),
        provider_id: req.provider_id.clone(),
        provider_name: req.provider_name.clone().unwrap_or("Dr. Smith".to_string()),
        appointment_type,
        visit_reason: req.reason.clone(),
        scheduled_date: req.preferred_date.clone(),
        start_time: req.preferred_time.clone(),
        scheduled_time,
        duration_minutes,
        status: crate::clinical::AppointmentStatus::Scheduled,
        location: crate::clinical::AppointmentLocation {
            facility_name: "MediChain General Hospital".to_string(),
            department: req
                .department
                .clone()
                .unwrap_or("General Medicine".to_string()),
            room: None,
            address: Some("123 Healthcare Way, Medical District".to_string()),
            telehealth_link: None,
        },
        created_at: chrono::Utc::now().timestamp(),
        updated_at: chrono::Utc::now().timestamp(),
        created_by: current_user_id.clone(),
        booked_by: Some(current_user_id),
        check_in_time: None,
        is_telehealth,
        reminders_sent: Vec::new(),
        instructions: req.instructions.clone(),
        insurance_verified: false,
        notes: req.notes.clone(),
    };

    let appointment_id = appointment.appointment_id.clone();
    if let Ok(mut appointments) = data.appointments.write() {
        appointments.insert(appointment_id.clone(), appointment);
    } else {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to store appointment".to_string(),
            code: "INTERNAL_ERROR".to_string(),
        });
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "appointment_id": appointment_id,
        "message": "Appointment booked successfully"
    }))
}

/// Get patient appointments
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

    // Auth check
    if current_user_id != patient_id && !current_user_id.starts_with("0xPROV") {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_appointments: Vec<crate::clinical::Appointment> = data
        .appointments
        .read()
        .map(|appointments| {
            appointments
                .values()
                .filter(|appointment| appointment.patient_id == patient_id)
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "appointments": patient_appointments,
        "count": patient_appointments.len()
    }))
}

/// Get provider appointments
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

    // Providers can only see their own appointments (demo restriction)
    if current_user_id != provider_id && !current_user_id.starts_with("0xADMIN") {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let provider_appointments: Vec<crate::clinical::Appointment> = data
        .appointments
        .read()
        .map(|appointments| {
            appointments
                .values()
                .filter(|appointment| appointment.provider_id == provider_id)
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "appointments": provider_appointments,
        "count": provider_appointments.len()
    }))
}

/// Cancel appointment request
#[derive(Debug, Deserialize)]
pub struct CancelAppointmentRequest {
    pub reason: String,
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

    let mut appointments = match data.appointments.write() {
        Ok(appointments) => appointments,
        Err(_) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to access appointments".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    };
    let appointment = match appointments.get_mut(&appointment_id) {
        Some(appointment) => appointment,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Auth check: patient or provider
    if current_user_id != appointment.patient_id && current_user_id != appointment.provider_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    appointment.status = crate::clinical::AppointmentStatus::Cancelled;
    appointment.notes = Some(format!(
        "{}Cancellation reason: {}",
        appointment
            .notes
            .as_ref()
            .map(|notes| format!("{notes}\n"))
            .unwrap_or_default(),
        req.reason
    ));
    appointment.updated_at = chrono::Utc::now().timestamp();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Appointment cancelled"
    }))
}

/// Check-in for an appointment
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

    let mut appointments = match data.appointments.write() {
        Ok(appointments) => appointments,
        Err(_) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to access appointments".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    };
    let appointment = match appointments.get_mut(&appointment_id) {
        Some(appointment) => appointment,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient can check in (usually via NFC/GPS at the clinic)
    if current_user_id != appointment.patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the patient can check in for an appointment".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    appointment.status = crate::clinical::AppointmentStatus::CheckedIn;
    appointment.check_in_time = Some(chrono::Utc::now().timestamp());
    appointment.updated_at = chrono::Utc::now().timestamp();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Arrived at clinic. Please wait for your name to be called."
    }))
}

/// Get available slots for a provider
#[get("/api/appointments/slots/{provider_id}/{date}")]
pub async fn get_available_slots(
    data: web::Data<crate::AppState>,
    _http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (provider_id, date) = path.into_inner();

    // In a real system, this would query the provider's schedule and existing appointments
    // For demo, return some mock slots
    let slots = vec![
        "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30",
    ];

    // Filter out already booked slots for this provider on this date
    let booked_times: Vec<String> = data
        .appointments
        .read()
        .map(|appointments| {
            appointments
                .values()
                .filter(|appointment| {
                    appointment.provider_id == provider_id
                        && appointment.scheduled_date == date
                        && appointment.status != crate::clinical::AppointmentStatus::Cancelled
                })
                .map(|appointment| appointment.start_time.clone())
                .collect()
        })
        .unwrap_or_default();

    let available_slots: Vec<&str> = slots
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
