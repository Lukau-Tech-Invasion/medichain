//! Clinician-authored note templates, shared across the facility.
//!
//! The template screen offered Create, Duplicate and Delete and announced
//! success for each, but all three only changed the browser's list: a template
//! vanished on reload, and using one answered "Unknown note template" because
//! the server had never heard of it.
//!
//! Templates written here are visible to every clinician (owner decision,
//! 2026-09-19). Doctors and nurses may create them; only the author or an
//! administrator may deactivate one. Deactivation hides a template rather than
//! erasing it (ADR-0005 defers irreversible deletion), and is a conditional
//! write so two people retiring the same template cannot both "succeed".
//! Built-in templates are read-only.

use super::*;

/// The page's closed vocabularies. A free-typed value would be stored and then
/// never match the page's filters, so the template would be filed and unfindable.
const TEMPLATE_TYPES: [&str; 7] = [
    "history-physical",
    "progress-note",
    "discharge-summary",
    "consult",
    "procedure",
    "soap",
    "op-note",
];
const TEMPLATE_CATEGORIES: [&str; 6] = [
    "general",
    "emergency",
    "surgery",
    "medicine",
    "pediatrics",
    "psychiatry",
];
const MAX_SECTIONS: usize = 30;
const MAX_NAME_CHARS: usize = 120;
const MAX_SECTION_CHARS: usize = 5_000;
const MAX_LABELS: usize = 30;

/// What the template form submits.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteTemplateRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub template_type: String,
    pub category: String,
    #[serde(default)]
    pub description: String,
    pub sections: Vec<NoteTemplateSectionInput>,
    #[serde(default)]
    pub macros: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// One section of a template, in the order the clinician arranged them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTemplateSectionInput {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub required: bool,
}

fn invalid(error: &str) -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        error: error.to_string(),
        code: "VALIDATION_ERROR".to_string(),
    })
}

/// Refuse a template the page could not file or a clinician could not use.
fn validate_template(req: &CreateNoteTemplateRequest) -> Result<(), HttpResponse> {
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(invalid("A template needs a name of at most 120 characters"));
    }
    if !TEMPLATE_TYPES.contains(&req.template_type.as_str()) {
        return Err(invalid("Unknown template type"));
    }
    if !TEMPLATE_CATEGORIES.contains(&req.category.as_str()) {
        return Err(invalid("Unknown template category"));
    }
    if req.sections.is_empty() || req.sections.len() > MAX_SECTIONS {
        return Err(invalid("A template needs between 1 and 30 sections"));
    }
    let bad_section = req.sections.iter().any(|section| {
        section.title.trim().is_empty()
            || section.title.chars().count() > MAX_NAME_CHARS
            || section.content.chars().count() > MAX_SECTION_CHARS
    });
    if bad_section {
        return Err(invalid(
            "Every section needs a title; content is limited to 5000 characters",
        ));
    }
    if req.macros.len() > MAX_LABELS || req.tags.len() > MAX_LABELS {
        return Err(invalid("At most 30 macros and 30 tags"));
    }
    Ok(())
}

/// The stored and served shape. Top-level keys match the built-in registry;
/// sections are an ordered array because a JSON object (and JSONB) does not
/// keep key order, and a SOAP note read as A, O, P, S is not a SOAP note.
fn stored_template(
    req: &CreateNoteTemplateRequest,
    template_id: &str,
    author: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> serde_json::Value {
    let sections: Vec<serde_json::Value> = req
        .sections
        .iter()
        .enumerate()
        .map(|(index, section)| {
            serde_json::json!({
                "sectionId": format!("{template_id}-S{:02}", index + 1),
                "title": section.title.trim(),
                "content": section.content,
                "required": section.required,
                "order": index + 1,
            })
        })
        .collect();
    serde_json::json!({
        "template_id": template_id,
        "name": req.name.trim(),
        "type": req.template_type,
        "category": req.category,
        "description": req.description.trim(),
        "sections": sections,
        "macros": req.macros,
        "tags": req.tags,
        "created_by": author,
        "created_at": now.to_rfc3339(),
        "updated_at": now.to_rfc3339(),
        "status": "active",
        "is_active": true,
        "built_in": false,
    })
}

fn is_active(record: &crate::repositories::traits::JsonRecordEntity) -> bool {
    record.data.get("status").and_then(|value| value.as_str()) == Some("active")
}

/// Every active clinician-authored template, newest first.
pub(super) async fn active_custom_templates(
    data: &web::Data<AppState>,
) -> RepositoryResult<Vec<serde_json::Value>> {
    let records = data.repositories.note_templates.list_all().await?;
    Ok(records
        .into_iter()
        .filter(is_active)
        .map(|record| record.data)
        .collect())
}

/// One active clinician-authored template, if `template_id` names one.
pub(super) async fn find_active_custom_template(
    data: &web::Data<AppState>,
    template_id: &str,
) -> RepositoryResult<Option<serde_json::Value>> {
    let record = data
        .repositories
        .note_templates
        .get_by_id(template_id)
        .await?;
    Ok(record.filter(is_active).map(|record| record.data))
}

/// Save a template for every clinician in the facility to use.
#[post("/api/templates/notes")]
pub async fn create_note_template(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<CreateNoteTemplateRequest>,
) -> impl Responder {
    let user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only clinicians who document notes can create note templates".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }
    let req = body.into_inner();
    if let Err(response) = validate_template(&req) {
        return response;
    }
    let now = chrono::Utc::now();
    let template_id = format!("TPL-USR-{}", uuid::Uuid::new_v4().simple());
    let template = stored_template(&req, &template_id, &user.wallet_address, now);
    let record = crate::repositories::traits::JsonRecordEntity {
        id: template_id.clone(),
        owner_id: user.wallet_address.clone(),
        data: template.clone(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.note_templates.create(record).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "template": template,
        })),
        Err(error) => {
            log::error!("note template persistence failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The template could not be saved".to_string(),
                code: "TEMPLATE_PERSISTENCE_FAILED".to_string(),
            })
        }
    }
}

/// Who may retire a shared template: its author, or an administrator.
fn may_deactivate(
    user: &crate::User,
    record: &crate::repositories::traits::JsonRecordEntity,
) -> bool {
    user.role.is_admin()
        || (user.role.can_edit_medical_records() && record.owner_id == user.wallet_address)
}

/// Hide a clinician-authored template from every clinician. Not a deletion.
#[post("/api/templates/notes/{template_id}/deactivate")]
pub async fn deactivate_note_template(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let template_id = path.into_inner();
    if super::compliance::is_builtin_note_template(&template_id) {
        return HttpResponse::Conflict().json(ErrorResponse {
            error: "Built-in templates cannot be deactivated".to_string(),
            code: "BUILT_IN_TEMPLATE".to_string(),
        });
    }
    let record = match data
        .repositories
        .note_templates
        .get_by_id(&template_id)
        .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Unknown note template".to_string(),
                code: "TEMPLATE_NOT_FOUND".to_string(),
            })
        }
        Err(error) => {
            log::error!("note template read failed: {error}");
            return HttpResponse::ServiceUnavailable().finish();
        }
    };
    if !may_deactivate(&user, &record) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only the template's author or an administrator can deactivate it".to_string(),
            code: "NOT_TEMPLATE_AUTHOR".to_string(),
        });
    }
    let now = chrono::Utc::now();
    let mut retired = record.clone();
    retired.data["status"] = serde_json::json!("deactivated");
    retired.data["is_active"] = serde_json::json!(false);
    retired.data["deactivated_by"] = serde_json::json!(user.wallet_address);
    retired.data["deactivated_at"] = serde_json::json!(now.to_rfc3339());
    retired.data["updated_at"] = serde_json::json!(now.to_rfc3339());
    retired.updated_at = now;
    match data
        .repositories
        .note_templates
        .replace_if_field_eq(&template_id, "status", "active", retired)
        .await
    {
        Ok(Some(_)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "template_id": template_id,
        })),
        Ok(None) => HttpResponse::Conflict().json(ErrorResponse {
            error: "This template has already been deactivated".to_string(),
            code: "TEMPLATE_NOT_ACTIVE".to_string(),
        }),
        Err(error) => {
            log::error!("note template deactivation failed: {error}");
            HttpResponse::ServiceUnavailable().finish()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test;

    fn register(state: &AppState, wallet: &str, role: crate::Role) {
        state.users.write().unwrap().insert(
            wallet.to_string(),
            crate::User {
                wallet_address: wallet.to_string(),
                username: Some(wallet.to_string()),
                name: "Test Clinician".to_string(),
                role,
                created_at: chrono::Utc::now(),
                created_by: None,
                linked_patient_id: None,
                email: None,
                phone: None,
                department: None,
                specialty: None,
                license_number: None,
                status: "active".to_string(),
                last_login: None,
            },
        );
    }

    fn state() -> web::Data<AppState> {
        let state = crate::AppState::new();
        register(&state, "doctor_a", crate::Role::Doctor);
        register(&state, "nurse_b", crate::Role::Nurse);
        register(&state, "pharmacist", crate::Role::Pharmacist);
        register(&state, "admin", crate::Role::Admin);
        web::Data::new(state)
    }

    macro_rules! app {
        ($state:expr) => {
            test::init_service(
                actix_web::App::new()
                    .app_data($state.clone())
                    .service(create_note_template)
                    .service(deactivate_note_template)
                    .service(super::super::compliance::get_note_templates)
                    .service(super::super::compliance::use_note_template),
            )
            .await
        };
    }

    fn body() -> serde_json::Value {
        serde_json::json!({
            "name": "Asthma review",
            "type": "soap",
            "category": "medicine",
            "description": "Follow-up after an exacerbation",
            "sections": [
                { "title": "Subjective", "content": "Night symptoms: [NIGHT]", "required": true },
                { "title": "Objective", "content": "PEF [PEF] L/min" },
                { "title": "Assessment", "content": "Control: [CONTROL]" },
                { "title": "Plan", "content": "Review in [WEEKS] weeks" }
            ]
        })
    }

    macro_rules! create {
        ($app:expr, $who:expr) => {{
            let created: serde_json::Value = test::call_and_read_body_json(
                $app,
                test::TestRequest::post()
                    .uri("/api/templates/notes")
                    .insert_header(("x-user-id", $who))
                    .set_json(body())
                    .to_request(),
            )
            .await;
            created["template"]["template_id"]
                .as_str()
                .expect("template id")
                .to_string()
        }};
    }

    /// The whole point: what one clinician saves, another can find and use,
    /// with its sections in the order they were written.
    #[actix_web::test]
    async fn a_saved_template_is_listed_for_colleagues_and_renders_in_order() {
        let state = state();
        let app = app!(state);
        let id = create!(&app, "doctor_a");

        let listed: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::get()
                .uri("/api/templates/notes")
                .insert_header(("x-user-id", "nurse_b"))
                .to_request(),
        )
        .await;
        let templates = listed["templates"].as_array().unwrap();
        let mine = templates
            .iter()
            .find(|t| t["template_id"] == id.as_str())
            .expect("a colleague's template is listed");
        assert_eq!(mine["built_in"], false);
        assert!(templates
            .iter()
            .any(|t| t["template_id"] == "TPL-SOAP-ROUTINE" && t["built_in"] == true));

        let used: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri("/api/templates/notes/use")
                .insert_header(("x-user-id", "nurse_b"))
                .set_json(serde_json::json!({ "template_id": id, "variables": { "PEF": "410" } }))
                .to_request(),
        )
        .await;
        let titles: Vec<&str> = used["rendered_sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["title"].as_str().unwrap())
            .collect();
        assert_eq!(titles, ["Subjective", "Objective", "Assessment", "Plan"]);
        assert_eq!(used["rendered_sections"][1]["content"], "PEF 410 L/min");
    }

    #[actix_web::test]
    async fn only_documenting_roles_create_templates() {
        let state = state();
        let app = app!(state);
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/templates/notes")
                .insert_header(("x-user-id", "pharmacist"))
                .set_json(body())
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::FORBIDDEN);
    }

    #[actix_web::test]
    async fn a_template_with_no_sections_is_refused() {
        let state = state();
        let app = app!(state);
        let mut empty = body();
        empty["sections"] = serde_json::json!([]);
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/templates/notes")
                .insert_header(("x-user-id", "doctor_a"))
                .set_json(empty)
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
    }

    /// A colleague cannot retire someone else's template; the author and an
    /// administrator can, once; after that it is neither listed nor usable.
    #[actix_web::test]
    async fn deactivation_is_the_authors_or_an_administrators_and_happens_once() {
        let state = state();
        let app = app!(state);
        let id = create!(&app, "doctor_a");
        let deactivate = |who: &'static str| {
            test::TestRequest::post()
                .uri(&format!("/api/templates/notes/{id}/deactivate"))
                .insert_header(("x-user-id", who))
                .to_request()
        };

        let by_colleague = test::call_service(&app, deactivate("nurse_b")).await;
        assert_eq!(
            by_colleague.status(),
            actix_web::http::StatusCode::FORBIDDEN
        );
        let by_author = test::call_service(&app, deactivate("doctor_a")).await;
        assert!(by_author.status().is_success());
        let again = test::call_service(&app, deactivate("admin")).await;
        assert_eq!(again.status(), actix_web::http::StatusCode::CONFLICT);

        let listed: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::get()
                .uri("/api/templates/notes")
                .insert_header(("x-user-id", "doctor_a"))
                .to_request(),
        )
        .await;
        assert!(!listed["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["template_id"] == id.as_str()));
        let used = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/templates/notes/use")
                .insert_header(("x-user-id", "doctor_a"))
                .set_json(serde_json::json!({ "template_id": id }))
                .to_request(),
        )
        .await;
        assert_eq!(used.status(), actix_web::http::StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn a_built_in_template_cannot_be_deactivated() {
        let state = state();
        let app = app!(state);
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/templates/notes/TPL-SOAP-ROUTINE/deactivate")
                .insert_header(("x-user-id", "admin"))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::CONFLICT);
    }
}
