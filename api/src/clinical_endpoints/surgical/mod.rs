pub use super::*;

mod diagnostics;
mod perioperative;
mod public_health;

pub use diagnostics::*;
pub use perioperative::*;
pub use public_health::*;

/// Provider-or-self gate for the peri-operative list-by-patient endpoints.
/// Mirrors the emergency module's `require_emergency_list_access` (HZ-020).
fn require_surgical_list_access(
    data: &web::Data<AppState>,
    http_req: &HttpRequest,
    patient_id: &str,
) -> Result<(), HttpResponse> {
    let current_user_id = match get_current_user_id(http_req) {
        Some(id) => id,
        None => return Err(HttpResponse::Unauthorized().finish()),
    };
    match get_user(data, &current_user_id) {
        Some(u)
            if u.role.is_healthcare_provider()
                || crate::support::caller_owns_patient_record(
                    &data,
                    &current_user_id,
                    &patient_id,
                ) =>
        {
            Ok(())
        }
        Some(_) => Err(HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        })),
        None => Err(HttpResponse::Unauthorized().finish()),
    }
}
