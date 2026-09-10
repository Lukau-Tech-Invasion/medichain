//! Shared request-validation helpers for clinical endpoint handlers.
//!
//! `crate::clinical_endpoints::*` grew to ~478 handlers largely by copy/paste, and
//! two request-validation blocks were duplicated verbatim at the top of dozens of
//! them:
//!   1. Extracting the caller's id from the `X-User-Id` header, 401'ing with a
//!      fixed `ErrorResponse` body if absent (60 occurrences across the crate).
//!   2. Looking the id up in `data.users`, 401'ing with a fixed `ErrorResponse`
//!      body if unknown (28 occurrences).
//!
//! These helpers are a pure extraction of that exact duplicated code — same
//! status codes, same JSON bodies, same field values — not a behavior change.
//!
//! `require_x_user_id_header` deliberately checks **only** the legacy
//! `X-User-Id` header, matching what every inlined call site did before this
//! extraction. It does NOT fall back to a JWT bearer token the way
//! `crate::support::get_current_user_id` does; folding JWT support into these
//! call sites would change what a request needs to authenticate and is left
//! for a separate, deliberate pass rather than bundled into this refactor.

use super::*;

/// Extract the caller's wallet address from the legacy `X-User-Id` header, or
/// return the canonical 401 response every handler inlined for a missing header.
///
/// Callers propagate the error with `let id = match require_x_user_id_header(&req) { Ok(id) => id, Err(resp) => return resp };`
pub(crate) fn require_x_user_id_header(req: &HttpRequest) -> Result<String, HttpResponse> {
    match req.headers().get("X-User-Id") {
        Some(id) => Ok(id.to_str().unwrap_or("").to_string()),
        None => Err(HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })),
    }
}

/// Look up a user record by id in the in-memory user store, or return the
/// canonical 401 "user not found" response every handler inlined for an
/// unknown id.
pub(crate) fn require_known_user(
    data: &web::Data<AppState>,
    user_id: &str,
) -> Result<User, HttpResponse> {
    let users = data.users.read().unwrap();
    match users.get(user_id) {
        Some(u) => Ok(u.clone()),
        None => Err(HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    #[test]
    fn require_x_user_id_header_extracts_present_header() {
        let req = TestRequest::default()
            .insert_header(("X-User-Id", "wallet-123"))
            .to_http_request();
        assert_eq!(require_x_user_id_header(&req).unwrap(), "wallet-123");
    }

    #[test]
    fn require_x_user_id_header_401s_when_missing() {
        let req = TestRequest::default().to_http_request();
        let err = require_x_user_id_header(&req).unwrap_err();
        assert_eq!(err.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }
}

/// Rewrite an incoming object's keys from the browser's casing to the API's.
///
/// # Why this exists
///
/// Six assessment handlers — obstetric, paediatric, psychiatric, toxicology,
/// splint and intubation — read their fields out of an untyped
/// `serde_json::Value` in snake_case, while the pages that post to them build
/// their state objects in camelCase. Every lookup missed, and every miss ended
/// in `unwrap_or_default()`, so the handler wrote a row whose `patient_id` was
/// `""`, whose gravida and para were `0`, and whose emergency flags were all
/// `false` — and returned `201`.
///
/// The clinical content was not lost, because these handlers also store the raw
/// body in their `data` blob and the pages read that back. What was lost is
/// every **typed column**: the ones a dashboard aggregates, a safety query
/// filters on, and an export reads. An obstetric emergency recorded against an
/// empty patient id is invisible to all three.
///
/// # Why normalise rather than add aliases
///
/// Most of the mismatches are pure casing (`patientId` / `patient_id`,
/// `chiefComplaint` / `chief_complaint`), and there are several hundred of
/// them across the six. Rewriting the keys once at the boundary fixes all of
/// those in one place instead of six hundred lookups, and leaves only the
/// genuine *name* differences — `gestationalAge` versus
/// `gestational_age_weeks` — to be handled explicitly where they occur.
///
/// # What it does not do
///
/// It does not recurse into nested objects. The nested structures these pages
/// send (`cervicalExam`, `fetalMonitoring`, `contractions`) are read from the
/// `data` blob by the page that wrote them, and rewriting their interiors would
/// change what that page reads back. Only top-level keys are touched.
///
/// A key already in snake_case is left alone, and a rewritten key never
/// overwrites one that was already present — an explicit `patient_id` wins over
/// a `patientId` in the same body, because the explicit one is the API's own
/// spelling.
pub(crate) fn normalise_body_keys(body: serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(map) = body else {
        return body;
    };
    let mut out = serde_json::Map::with_capacity(map.len());
    // Two passes so an explicit snake_case key always wins, whichever order the
    // client happened to serialise them in.
    for (key, value) in &map {
        if !key.chars().any(|c| c.is_ascii_uppercase()) {
            out.insert(key.clone(), value.clone());
        }
    }
    for (key, value) in &map {
        if !key.chars().any(|c| c.is_ascii_uppercase()) {
            continue;
        }
        let snake = to_snake_case(key);
        out.entry(snake).or_insert_with(|| value.clone());
        // The original stays too: the `data` blob is built from this same value
        // and the page reads its own spelling back out of it.
        out.insert(key.clone(), value.clone());
    }
    serde_json::Value::Object(out)
}

/// `gestationalAge` -> `gestational_age`, `patientID` -> `patient_id`.
fn to_snake_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 4);
    let chars: Vec<char> = key.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if c.is_ascii_uppercase() {
            // No separator at the start, and none inside a run of capitals
            // unless the run is ending (`patientID` -> `patient_id`, not
            // `patient_i_d`).
            let prev_lower = i > 0 && chars[i - 1].is_ascii_lowercase();
            let next_lower = chars.get(i + 1).is_some_and(|n| n.is_ascii_lowercase());
            let prev_upper = i > 0 && chars[i - 1].is_ascii_uppercase();
            if i > 0 && (prev_lower || (prev_upper && next_lower)) {
                out.push('_');
            }
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(*c);
        }
    }
    out
}

#[cfg(test)]
mod normalise_tests {
    use super::*;

    #[test]
    fn camel_case_keys_become_snake_case() {
        let body = serde_json::json!({ "patientId": "PAT-1", "chiefComplaint": "pain" });
        let out = normalise_body_keys(body);
        assert_eq!(out["patient_id"], "PAT-1");
        assert_eq!(out["chief_complaint"], "pain");
    }

    #[test]
    fn the_original_spelling_is_kept_for_the_data_blob() {
        // These handlers store the body verbatim and the page reads its own
        // field names back out of it. Dropping the camelCase key would fix the
        // columns and break the screen.
        let out = normalise_body_keys(serde_json::json!({ "patientId": "PAT-1" }));
        assert_eq!(out["patientId"], "PAT-1");
    }

    #[test]
    fn an_explicit_snake_case_key_wins() {
        let out = normalise_body_keys(
            serde_json::json!({ "patient_id": "explicit", "patientId": "camel" }),
        );
        assert_eq!(out["patient_id"], "explicit");
    }

    #[test]
    fn a_run_of_capitals_does_not_become_one_underscore_per_letter() {
        let out = normalise_body_keys(serde_json::json!({ "patientID": "PAT-1" }));
        assert_eq!(out["patient_id"], "PAT-1");
    }

    #[test]
    fn a_non_object_body_is_returned_unchanged() {
        let out = normalise_body_keys(serde_json::json!([1, 2, 3]));
        assert_eq!(out, serde_json::json!([1, 2, 3]));
    }
}

/// Refuse a clinical record whose patient does not exist.
///
/// Every assessment handler in `assessment/` built its entity with
/// `patient_id: body.get("patient_id")...unwrap_or_default()` and then wrote
/// it. With the key mismatch fixed the id now resolves, but an id that resolves
/// is not an id that exists: a typo, a stale tab or a copied URL still produced
/// a stored assessment attached to nobody, discoverable by no query and
/// belonging to no chart.
///
/// Fails closed, and says which patient, because "not found" without the id is
/// a bug report nobody can act on.
pub(crate) async fn require_known_patient(
    data: &actix_web::web::Data<crate::state::AppState>,
    patient_id: &str,
) -> Result<(), actix_web::HttpResponse> {
    if patient_id.trim().is_empty() {
        return Err(
            actix_web::HttpResponse::BadRequest().json(crate::ErrorResponse {
                success: false,
                error: "patient_id is required".to_string(),
                code: "MISSING_PATIENT_ID".to_string(),
            }),
        );
    }
    if data
        .repositories
        .patients
        .get_by_id(patient_id)
        .await
        .is_err()
    {
        return Err(
            actix_web::HttpResponse::NotFound().json(crate::ErrorResponse {
                success: false,
                error: format!("Patient '{patient_id}' not found"),
                code: "PATIENT_NOT_FOUND".to_string(),
            }),
        );
    }
    Ok(())
}
