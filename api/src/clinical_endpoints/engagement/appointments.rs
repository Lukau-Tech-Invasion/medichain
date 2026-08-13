use super::*;

// ============================================================================
// PHASE 23: APPOINTMENT BOOKING SYSTEM
// ============================================================================

/// Book appointment request
#[derive(Debug, Deserialize)]
pub struct BookAppointmentRequest {
    pub patient_id: String,
    /// A *request* for which provider, not an assertion. Validated against the
    /// caller by `resolve_attributed_provider`; see the handler.
    pub provider_id: String,
    // `provider_name` was removed here rather than left unread. It let a client
    // label an appointment with any name it liked, independent of
    // `provider_id`, and the name is now taken from the resolved provider
    // record. Serde ignores unknown fields, so clients still sending it are
    // unaffected.
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

/// Map the client's appointment-type string onto the domain enum.
///
/// # Why this is a function with a `None` arm
///
/// The previous inline `match` listed only PascalCase spellings (`"Telehealth"`,
/// `"FollowUp"`) and ended in `_ => FollowUp`. The doctor portal sends
/// lowercase, hyphenated values (`"telehealth"`, `"follow-up"`), so **every**
/// appointment booked from the portal fell through the catch-all and was stored
/// as a follow-up — which also left `is_telehealth` false, making it impossible
/// to book a telehealth appointment at all (`docs/WORKFLOW_AUDIT.md`, WF-005).
///
/// A catch-all arm over a client-supplied enum turns a contract mismatch into
/// silent data corruption, so there is deliberately no default here: an
/// unrecognised type is rejected and the caller finds out.
///
/// Comparison is case-insensitive with `-`/`_`/space folded, so the same
/// vocabulary works from either spelling convention without a second table to
/// keep in sync.
fn parse_appointment_type(raw: &str) -> Option<crate::clinical::AppointmentType> {
    use crate::clinical::AppointmentType as T;
    let key: String = raw
        .chars()
        .filter(|c| !matches!(c, '-' | '_' | ' '))
        .flat_map(char::to_lowercase)
        .collect();
    Some(match key.as_str() {
        "newpatient" => T::NewPatient,
        "followup" | "routine" => T::FollowUp,
        "urgent" | "emergency" => T::Urgent,
        "telehealth" | "virtual" | "video" => T::Telehealth,
        "procedure" => T::Procedure,
        "preop" | "surgerypreop" => T::PreOp,
        "postop" => T::PostOp,
        "annualexam" | "screening" => T::AnnualExam,
        "consultation" | "specialistconsultation" | "consult" => T::Consultation,
        "labwork" | "lab" => T::LabWork,
        "imaging" | "radiology" => T::Imaging,
        // Genuinely "something else", and the only way to reach `Other`:
        // reachable on purpose, unlike the old silent default.
        "vaccination" | "immunisation" | "immunization" | "antenatal" | "other" => T::Other,
        _ => return None,
    })
}

/// Book an appointment
#[post("/api/appointments")]
pub async fn book_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<BookAppointmentRequest>,
) -> impl Responder {
    // Who the appointment is attributed to is decided from the session, not the
    // body. Before this, `provider_id` was copied verbatim out of the request:
    // the handler checked that the caller could book for the *patient* and then
    // never checked the *provider* at all, so any provider could put an
    // appointment on a colleague's calendar under the colleague's name
    // (`docs/WORKFLOW_AUDIT.md`, WF-004).
    //
    // The helper allows exactly three shapes: a clinician booking for
    // themselves, an admin scheduling for a colleague (with the real actor kept
    // for the audit trail), and a patient choosing which provider to see.
    let attribution = match crate::support::resolve_attributed_provider(
        &data,
        &http_req,
        Some(req.provider_id.as_str()),
    ) {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let current_user_id = attribution.actor_id().to_string();

    // User must be booking for themselves or be a healthcare provider/authorized relative.
    // Resolve the caller from the server-side account registry instead of trusting a
    // legacy ID prefix: production wallet addresses do not encode a user's role.
    if current_user_id != req.patient_id {
        let is_provider = crate::get_user(&data, &current_user_id)
            .is_some_and(|user| user.role.is_healthcare_provider());
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

    let appointment_type = match parse_appointment_type(&req.appointment_type) {
        Some(t) => t,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: format!(
                    "'{}' is not a recognised appointment type",
                    req.appointment_type
                ),
                code: "UNKNOWN_APPOINTMENT_TYPE".to_string(),
            })
        }
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
        // Server-derived. Equal to what the client asked for only when that
        // request was legitimate.
        provider_id: attribution.provider_id().to_string(),
        // Horizon HZ-023: this defaulted to the literal "Dr. Smith", stamping an
        // invented clinician onto a real appointment whenever the caller omitted
        // a name. Resolve the actual provider from the user store; if the id is
        // unknown, carry the id itself rather than inventing a person.
        // Taken from the resolved provider record, not from the body: a
        // client-supplied `provider_name` could otherwise label an appointment
        // with any name it liked, independently of `provider_id`.
        provider_name: attribution.provider.name.clone(),
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
    let appointment_patient_id = appointment.patient_id.clone();
    let appointment_provider_name = appointment.provider_name.clone();
    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    // Atomically checks for an overlapping booking and inserts in the same
    // transaction (11.1 TOCTOU) so two concurrent requests can't double-book
    // the same provider slot.
    if let Err(e) = data.repositories.book_appointment_atomic(entity).await {
        return match e {
            crate::repositories::traits::RepositoryError::Duplicate(msg) => {
                HttpResponse::Conflict().json(ErrorResponse {
                    success: false,
                    error: msg,
                    code: "SLOT_UNAVAILABLE".to_string(),
                })
            }
            other => HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: format!("Failed to store appointment: {}", other),
                code: "INTERNAL_ERROR".to_string(),
            }),
        };
    }

    // FCM push: appointment booking confirmation.
    {
        let repos = data.repositories.clone();
        tokio::spawn(async move {
            let _ = crate::notifications::send_push_to_user(
                &repos,
                crate::notifications::PushNotification {
                    user_id: appointment_patient_id,
                    title: "Appointment Confirmed".to_string(),
                    body: format!(
                        "Your appointment with {} has been booked.",
                        appointment_provider_name
                    ),
                    data: Some([("type".to_string(), "appointment_confirmed".to_string())].into()),
                },
            )
            .await;
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

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // A patient can see their own appointments; registered healthcare staff can
    // review appointments for care coordination.
    let is_provider = crate::get_user(&data, &current_user_id)
        .is_some_and(|user| user.role.is_healthcare_provider());
    if !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
        && !is_provider
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_appointments: Vec<crate::clinical::Appointment> = data
        .repositories
        .appointments
        .get_by_patient(&patient_id, Pagination::new(0, 100))
        .await
        .map(|r| r.items.into_iter().map(Into::into).collect())
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

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Providers can only see their own appointments; registered administrators
    // may review schedules for operational support.
    let is_admin =
        crate::get_user(&data, &current_user_id).is_some_and(|user| user.role.is_admin());
    if current_user_id != provider_id && !is_admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let provider_appointments: Vec<crate::clinical::Appointment> = data
        .repositories
        .appointments
        .get_by_provider_all(&provider_id, Pagination::new(0, 100))
        .await
        .map(|r| r.items.into_iter().map(Into::into).collect())
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

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let appointment = match data
        .repositories
        .appointments
        .get_by_id(&appointment_id)
        .await
    {
        Ok(a) => a,
        Err(_) => {
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

    if let Err(e) = data
        .repositories
        .appointments
        .cancel(&appointment_id, &req.reason, &current_user_id)
        .await
    {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: format!("Failed to cancel appointment: {}", e),
            code: "INTERNAL_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Appointment cancelled"
    }))
}

/// Get a single appointment by id
// Added 2026-07-22: the shared client's `getAppointment(appointmentId)` had no
// matching backend route at all (only patient/provider list + slot lookups
// existed) — the repository already supported `get_by_id`, just nothing exposed it.
#[get("/api/appointments/{appointment_id}")]
pub async fn get_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let appointment_id = path.into_inner();

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let entity = match data
        .repositories
        .appointments
        .get_by_id(&appointment_id)
        .await
    {
        Ok(e) => e,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };
    let appointment: crate::clinical::Appointment = entity.into();

    // Patient, the assigned provider, or any registered healthcare provider may
    // view it. Never infer authorization from a user-ID prefix.
    let is_provider = crate::get_user(&data, &current_user_id)
        .is_some_and(|user| user.role.is_healthcare_provider());
    if current_user_id != appointment.patient_id
        && current_user_id != appointment.provider_id
        && !is_provider
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(appointment)
}

/// Check in a patient for their appointment
#[post("/api/appointments/{appointment_id}/check-in")]
pub async fn check_in_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let appointment_id = path.into_inner();

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let entity = match data
        .repositories
        .appointments
        .get_by_id(&appointment_id)
        .await
    {
        Ok(e) => e,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };
    let mut appointment: crate::clinical::Appointment = entity.into();

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

    if let Err(e) = data
        .repositories
        .appointments
        .update(appointment.into())
        .await
    {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: format!("Failed to check in: {}", e),
            code: "INTERNAL_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Arrived at clinic. Please wait for your name to be called."
    }))
}

/// Get available slots for a provider
///
/// HZ-009 audit: `_http_req` is genuinely unused, not an oversight — this
/// returns only anonymous open time slots for a provider/date (booked slots
/// and any patient/appointment identity are filtered out below), the same
/// class of information as a public booking calendar. `not_applicable`.
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
    let booked_times: Vec<String> = match chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d") {
        Ok(naive_date) => data
            .repositories
            .appointments
            .get_by_provider(&provider_id, naive_date)
            .await
            .map(|entities| {
                entities
                    .into_iter()
                    .map(crate::clinical::Appointment::from)
                    .filter(|appointment| {
                        appointment.status != crate::clinical::AppointmentStatus::Cancelled
                    })
                    .map(|appointment| appointment.start_time)
                    .collect()
            })
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };

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

/// Fetch every appointment across all pages (`AppointmentRepository::list_all` is
/// paginated; callers that genuinely need the whole set — the reminder scanner,
/// analytics — page through it here instead of duplicating the loop).
pub(crate) async fn fetch_all_appointments(
    data: &crate::AppState,
) -> Vec<crate::clinical::Appointment> {
    let mut all = Vec::new();
    let mut page = 0u32;
    loop {
        let result = match data
            .repositories
            .appointments
            .list_all(Pagination::new(page, Pagination::MAX_PER_PAGE))
            .await
        {
            Ok(r) => r,
            Err(_) => break,
        };
        if result.items.is_empty() {
            break;
        }
        let total = result.total;
        all.extend(
            result
                .items
                .into_iter()
                .map(crate::clinical::Appointment::from),
        );
        page += 1;
        if (page as u64) * (Pagination::MAX_PER_PAGE as u64) >= total {
            break;
        }
    }
    all
}

/// Check for upcoming appointments and send a one-time reminder (Phase 5.2 FCM).
/// Called by a background task, mirroring `check_and_send_medication_reminders`.
///
/// Sends once per appointment: any `Scheduled`/`Confirmed` appointment within the
/// next 24 hours with no `Push` entry yet in `reminders_sent` gets a reminder and
/// is marked, so re-running this scan doesn't re-notify the same appointment.
pub async fn check_and_send_appointment_reminders(data: &crate::AppState) {
    let now = chrono::Utc::now().timestamp();
    let window_end = now + 24 * 3600;

    let due: Vec<crate::clinical::Appointment> = fetch_all_appointments(data)
        .await
        .into_iter()
        .filter(|a| {
            matches!(
                a.status,
                crate::clinical::AppointmentStatus::Scheduled
                    | crate::clinical::AppointmentStatus::Confirmed
            )
        })
        .filter(|a| matches!(a.scheduled_time, Some(t) if t > now && t <= window_end))
        .filter(|a| {
            !a.reminders_sent
                .iter()
                .any(|r| r.reminder_type == crate::clinical::ReminderType::Push)
        })
        .collect();

    for mut appointment in due {
        log::info!(
            "APPOINTMENT_REMINDER_DUE: patient={} provider={} scheduled_time={:?}",
            appointment.patient_id,
            appointment.provider_name,
            appointment.scheduled_time
        );

        crate::websocket::push_reminder(
            &data.ws_manager,
            &appointment.patient_id,
            &format!("Appointment with {}", appointment.provider_name),
        );

        let repos = data.repositories.clone();
        let patient_id = appointment.patient_id.clone();
        let provider_name = appointment.provider_name.clone();
        tokio::spawn(async move {
            let _ = crate::notifications::send_push_to_user(
                &repos,
                crate::notifications::PushNotification {
                    user_id: patient_id,
                    title: "Upcoming Appointment".to_string(),
                    body: format!("You have an appointment with {} tomorrow.", provider_name),
                    data: Some([("type".to_string(), "appointment_reminder".to_string())].into()),
                },
            )
            .await;
        });

        appointment
            .reminders_sent
            .push(crate::clinical::AppointmentReminder {
                reminder_type: crate::clinical::ReminderType::Push,
                sent_at: now,
                status: crate::clinical::ReminderStatus::Sent,
            });
        let _ = data
            .repositories
            .appointments
            .update(appointment.into())
            .await;
    }
}

#[cfg(test)]
mod appointment_type_tests {
    use super::parse_appointment_type;
    use crate::clinical::AppointmentType as T;

    /// The regression that made telehealth impossible: the portal's own
    /// vocabulary must map to the types it names, not silently to FollowUp.
    #[test]
    fn the_doctor_portals_own_option_values_all_map_correctly() {
        assert_eq!(parse_appointment_type("consultation"), Some(T::Consultation));
        assert_eq!(parse_appointment_type("follow-up"), Some(T::FollowUp));
        assert_eq!(parse_appointment_type("procedure"), Some(T::Procedure));
        assert_eq!(parse_appointment_type("screening"), Some(T::AnnualExam));
        assert_eq!(parse_appointment_type("vaccination"), Some(T::Other));
        assert_eq!(parse_appointment_type("antenatal"), Some(T::Other));
        assert_eq!(
            parse_appointment_type("telehealth"),
            Some(T::Telehealth),
            "the whole telehealth workflow hangs off this one mapping"
        );
    }

    #[test]
    fn the_pascal_case_spellings_the_api_documented_still_work() {
        assert_eq!(parse_appointment_type("Telehealth"), Some(T::Telehealth));
        assert_eq!(parse_appointment_type("FollowUp"), Some(T::FollowUp));
        assert_eq!(parse_appointment_type("Routine"), Some(T::FollowUp));
        assert_eq!(parse_appointment_type("Emergency"), Some(T::Urgent));
        assert_eq!(parse_appointment_type("SurgeryPreOp"), Some(T::PreOp));
        assert_eq!(
            parse_appointment_type("SpecialistConsultation"),
            Some(T::Consultation)
        );
    }

    #[test]
    fn separators_and_case_do_not_change_the_meaning() {
        for spelling in ["follow up", "Follow-Up", "FOLLOW_UP", "followUp"] {
            assert_eq!(parse_appointment_type(spelling), Some(T::FollowUp), "{spelling}");
        }
    }

    /// The core of the fix. A catch-all default is what turned a client/server
    /// vocabulary mismatch into silently mis-filed clinical records.
    #[test]
    fn an_unrecognised_type_is_rejected_rather_than_defaulted() {
        assert_eq!(parse_appointment_type("brain-transplant"), None);
        assert_eq!(parse_appointment_type(""), None);
        assert_eq!(parse_appointment_type("  "), None);
    }
}

#[cfg(test)]
mod appointment_reminder_tests {
    use super::*;

    fn test_appointment(id: &str, hours_from_now: i64) -> crate::clinical::Appointment {
        crate::clinical::Appointment {
            appointment_id: id.to_string(),
            patient_id: "PAT-1".to_string(),
            provider_id: "PROV-1".to_string(),
            provider_name: "Dr. Test".to_string(),
            appointment_type: crate::clinical::AppointmentType::FollowUp,
            visit_reason: "Checkup".to_string(),
            scheduled_date: "2026-07-22".to_string(),
            start_time: "09:00".to_string(),
            scheduled_time: Some(chrono::Utc::now().timestamp() + hours_from_now * 3600),
            duration_minutes: 30,
            location: crate::clinical::AppointmentLocation {
                facility_name: "Test Clinic".to_string(),
                department: "General".to_string(),
                room: None,
                address: None,
                telehealth_link: None,
            },
            status: crate::clinical::AppointmentStatus::Scheduled,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            created_by: "PAT-1".to_string(),
            booked_by: Some("PAT-1".to_string()),
            check_in_time: None,
            is_telehealth: false,
            reminders_sent: Vec::new(),
            instructions: None,
            insurance_verified: false,
            notes: None,
        }
    }

    #[tokio::test]
    async fn sends_and_marks_reminder_for_appointment_within_24h() {
        let data = crate::AppState::new();
        data.repositories
            .appointments
            .create(test_appointment("APT-1", 12).into())
            .await
            .unwrap();

        check_and_send_appointment_reminders(&data).await;

        let a: crate::clinical::Appointment = data
            .repositories
            .appointments
            .get_by_id("APT-1")
            .await
            .unwrap()
            .into();
        assert_eq!(a.reminders_sent.len(), 1);
        assert_eq!(
            a.reminders_sent[0].reminder_type,
            crate::clinical::ReminderType::Push
        );
    }

    #[tokio::test]
    async fn does_not_resend_to_an_already_reminded_appointment() {
        let data = crate::AppState::new();
        let mut appointment = test_appointment("APT-2", 12);
        appointment
            .reminders_sent
            .push(crate::clinical::AppointmentReminder {
                reminder_type: crate::clinical::ReminderType::Push,
                sent_at: chrono::Utc::now().timestamp(),
                status: crate::clinical::ReminderStatus::Sent,
            });
        data.repositories
            .appointments
            .create(appointment.into())
            .await
            .unwrap();

        check_and_send_appointment_reminders(&data).await;

        let a: crate::clinical::Appointment = data
            .repositories
            .appointments
            .get_by_id("APT-2")
            .await
            .unwrap()
            .into();
        assert_eq!(a.reminders_sent.len(), 1);
    }

    #[tokio::test]
    async fn ignores_appointments_outside_the_24h_window() {
        let data = crate::AppState::new();
        data.repositories
            .appointments
            .create(test_appointment("APT-3", 48).into())
            .await
            .unwrap();
        data.repositories
            .appointments
            .create(test_appointment("APT-4", -1).into())
            .await
            .unwrap();

        check_and_send_appointment_reminders(&data).await;

        let a3: crate::clinical::Appointment = data
            .repositories
            .appointments
            .get_by_id("APT-3")
            .await
            .unwrap()
            .into();
        let a4: crate::clinical::Appointment = data
            .repositories
            .appointments
            .get_by_id("APT-4")
            .await
            .unwrap()
            .into();
        assert!(a3.reminders_sent.is_empty());
        assert!(a4.reminders_sent.is_empty());
    }
}
