//! The clinical scoring catalog endpoint.
//!
//! Publishes the thresholds and constants in `crate::clinical_scoring` so a form
//! can show a live preview — a Morse total updating as the boxes are ticked, a
//! Parkland volume updating as the body chart is filled — without carrying its
//! own copy of the policy.
//!
//! Reading a number from here is not the same as being scored. Every saved
//! record's score is recomputed by the server from the inputs it received; the
//! catalog exists so the preview and the stored value come from the same
//! arithmetic instead of two implementations that drift.

use super::*;

/// Clinical scoring thresholds and constants.
///
/// The bar is a **registered caller**, not a role. The catalog describes
/// protocol and carries no patient data at all, and a patient-facing page that
/// shows a score needs the same numbers a clinician's page uses. It is not
/// public: an unauthenticated endpoint here would be a free description of how
/// the product triages.
///
/// The caller is resolved inline rather than behind a helper on purpose.
/// `scripts/check-endpoint-auth.py` reads the handler body to classify an
/// endpoint's authorization tier and cannot follow a call into a helper — it
/// scored this endpoint tier 0, "no auth decision at all", when the decision
/// was one function away. An auth decision a reader or a gate cannot see at the
/// endpoint is one nobody can audit, so the gate was right and the helper went.
#[get("/api/clinical/scoring/catalog")]
pub async fn get_scoring_catalog(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = get_current_user_id(&http_req).and_then(|wallet| get_user(&data, &wallet));
    if caller.is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Unauthorized".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    HttpResponse::Ok()
        // The catalog changes only when the code does, so it is worth caching
        // in the browser for a working session. It is not patient data.
        .insert_header(("Cache-Control", "private, max-age=3600"))
        .json(crate::clinical_scoring::catalog())
}
