//! Patient-scoped listings for documents written *about* a patient.
//!
//! The patient portal could list lab results, IPFS-backed records, SOAP notes,
//! prescriptions and triage assessments, but nothing else — so a History &
//! Physical, a progress note, a wound assessment or a vital-signs reading was
//! created about the patient and then unreachable by them. The existing
//! listings for those kinds are ward-wide (`/api/clinical/hp`,
//! `/api/platform/list/progress-notes`, `/api/emergency/wound/list`) and are
//! restricted to clinical staff, which is correct: a patient must not be able
//! to enumerate other people's records to reach their own.
//!
//! Each endpoint here returns one patient's documents and authorises the caller
//! against that patient, so a patient may read their own and a provider may
//! read any.

use super::record_sections::{read_section, RecordSection};
use super::*;

/// A patient may read their own documents; any provider may read a patient's.
fn may_read(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    patient_id: &str,
) -> bool {
    caller.role.can_view_medical_records()
        || crate::support::caller_owns_patient_record(data, caller_id, patient_id)
}

/// Resolve and authorise the caller, or return the response to send instead.
fn authorize(
    data: &web::Data<AppState>,
    http_req: &HttpRequest,
    patient_id: &str,
) -> Result<(), HttpResponse> {
    let caller_id = get_current_user_id(http_req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })
    })?;
    let caller = get_user(data, &caller_id).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        })
    })?;
    if !may_read(data, &caller, &caller_id, patient_id) {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
            error: "You can only read your own records".to_string(),
            code: "ACCESS_DENIED".to_string(),
        }));
    }
    Ok(())
}

/// How many of each kind to return. Bounded per the project's rule against
/// unbounded reads; a patient's record list is paged in the UI anyway.
const PAGE: u32 = 100;

/// A section's own endpoint: the first page of it, or 503 when its storage
/// cannot be read (never an empty list standing in for "could not read").
async fn section_response(
    data: &web::Data<AppState>,
    patient_id: &str,
    section: RecordSection,
) -> HttpResponse {
    match read_section(data, patient_id, section, Pagination::new(0, PAGE)).await {
        Ok(body) => HttpResponse::Ok().json(body),
        Err(error) => {
            log::error!(
                "record section {} could not be read: {error}",
                section.key()
            );
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error:
                    "This part of the record could not be read right now. Please try again shortly."
                        .to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Default and largest page the records summary returns per section.
const SUMMARY_DEFAULT_PER_PAGE: u32 = 50;

/// Paging for the records summary, applied to every section.
#[derive(Debug, serde::Deserialize)]
pub struct SummaryQuery {
    /// 0-indexed page.
    #[serde(default)]
    pub page: u32,
    #[serde(default)]
    pub per_page: Option<u32>,
}

/// Every section of a patient's record in one response (WP11), each paged.
///
/// Replaces most of the ~20 reads the patient's records page made at once,
/// which alone spent a twelfth of the per-minute rate limit. A section that
/// cannot be read is named in `unavailable` rather than failing the whole
/// response or being shown as empty. The per-section reads are the same ones
/// each section's own endpoint uses. One disclosure row covers the read.
#[get("/api/patients/{patient_id}/records-summary")]
pub async fn get_records_summary(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<SummaryQuery>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    let per_page = query
        .per_page
        .unwrap_or(SUMMARY_DEFAULT_PER_PAGE)
        .clamp(1, PAGE);
    let page = Pagination::new(query.page, per_page);
    let reads = RecordSection::ALL
        .iter()
        .map(|section| read_section(&data, &patient_id, *section, page));
    let results = futures::future::join_all(reads).await;
    let mut sections = serde_json::Map::new();
    let mut unavailable = Vec::new();
    for (section, result) in RecordSection::ALL.iter().zip(results) {
        match result {
            Ok(body) => {
                sections.insert(section.key().to_string(), body);
            }
            Err(error) => {
                log::error!("records summary: {} unreadable: {error}", section.key());
                unavailable.push(section.key());
            }
        }
    }
    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "page": query.page,
        "per_page": per_page,
        "sections": sections,
        "unavailable": unavailable,
    }))
}

/// Every History & Physical recorded for one patient.
#[get("/api/clinical/patient/{patient_id}/history-physicals")]
pub async fn list_patient_history_physicals(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::HistoryPhysicals).await
}

/// Every progress note recorded for one patient.
#[get("/api/clinical/patient/{patient_id}/progress-notes")]
pub async fn list_patient_progress_notes(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::ProgressNotes).await
}

/// Every wound assessment recorded for one patient.
#[get("/api/clinical/patient/{patient_id}/wounds")]
pub async fn list_patient_wounds(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::Wounds).await
}

/// Everything written when this patient was discharged.
///
/// The discharge summary and the discharge instructions were reachable only as
/// `GET /api/clinical/discharge-summary/{summary_id}` and its instructions
/// sibling — keyed by an id the patient has never seen — plus
/// `GET /api/clinical/discharges`, the clinician's worklist, which a patient is
/// refused. So the one document a patient physically leaves hospital with
/// (what happened, what to take, what to come back for) could be written,
/// approved by a second clinician, stored, and never opened by the person it
/// was written for.
///
/// Both halves come back together, because a discharge is one event with two
/// documents and returning them separately would make the screen do the
/// joining — which is how one of the two gets forgotten.
#[get("/api/clinical/patient/{patient_id}/discharges")]
pub async fn list_patient_discharges(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::Discharges).await
}

/// Everything imaging that was ordered for, and reported about, this patient.
///
/// A radiology report was reachable only as
/// `GET /api/surgical/radiology/report/{report_id}` — keyed by an id the
/// patient has never seen, *and* gated on `require_clinical_staff`, so a
/// patient holding the id was refused anyway. The only other read is the
/// deployment-wide register. So the scan a patient was sent for, waited for and
/// worried about could be performed, reported, flagged critical, and never
/// opened by them.
///
/// Orders come back alongside reports: a patient asking "what about my scan?"
/// before the radiologist has read it needs to see the order, or the honest
/// answer is indistinguishable from no answer. Reports carry their own `status`
/// rather than being filtered on it — withholding a preliminary report is a
/// policy decision, and a screen that silently omits it cannot tell the patient
/// that a report exists but is not yet signed.
#[get("/api/clinical/patient/{patient_id}/imaging")]
pub async fn list_patient_imaging(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::Imaging).await
}

/// The pathology on this patient's own specimens.
///
/// A pathology report was reachable only as `GET /api/surgical/pathology/{id}`
/// — keyed by an accession number the patient has never seen — plus the
/// deployment-wide register. Both are gated on clinical staff.
///
/// A pathology report is where a cancer diagnosis, a margin status and a
/// staging live. It is also the result a patient chases hardest, and the one
/// they were least able to reach.
///
/// Reports carry their own `status` rather than being filtered on it. Holding a
/// finished report back until a clinician has discussed it is a defensible
/// policy, but it is a *policy*, and it has to be stated and configured — not
/// enacted by a route that quietly returns nothing. A screen that cannot
/// distinguish "no specimen was ever taken" from "the report exists and you may
/// not see it yet" tells the patient the first when the truth is the second.
#[get("/api/clinical/patient/{patient_id}/pathology")]
pub async fn list_patient_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::Pathology).await
}

/// Every specialist opinion asked for about this patient.
///
/// A consult was reachable only as `GET /api/clinical/consult/{consult_id}`,
/// keyed by an id the patient has never seen and gated on
/// `can_view_medical_records` — which excludes the patient — plus
/// `GET /api/platform/list/consults`, the deployment-wide register.
///
/// The consult is where the specialist's recommendation and follow-up plan
/// live: what the cardiologist actually said, and what they want done next. A
/// patient told "the specialist has seen your notes" and unable to read the
/// answer is being asked to take the recommendation on trust.
#[get("/api/clinical/patient/{patient_id}/consults")]
pub async fn list_patient_consults(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::Consults).await
}

/// The nursing care plan written for this patient.
///
/// The plan was reachable as `GET /api/emergency/care-plan/{id}`, keyed by an
/// id the patient has never seen, and as `GET /api/emergency/care-plan/list`
/// and `GET /api/nursing/care-plans` -- both ward-wide and both restricted to
/// providers, correctly: a patient must not be able to enumerate the ward to
/// reach their own plan.
///
/// A care plan is the one clinical document written in the second person. It
/// says what the goals of this admission are, what the nursing staff will do,
/// and what the patient is expected to do -- and the patient could not read it.
#[get("/api/clinical/patient/{patient_id}/care-plans")]
pub async fn list_patient_care_plans(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::CarePlans).await
}

/// This patient's blood work and any blood they were given.
///
/// Blood-bank orders and transfusion events were reachable only as
/// `GET /api/surgical/blood-type/{id}` and `GET /api/surgical/transfusion/{id}`
/// -- both keyed by a server-generated id the patient never sees -- plus
/// `GET /api/platform/list/blood-bank`, the deployment register.
///
/// A patient's own blood group is the single most reusable fact in their
/// record: it is what they are asked in every emergency department, on every
/// pre-operative form, at every blood donation. A transfusion history is the
/// other half -- what they were given, when, and whether they reacted to it.
///
/// Both are stored as JSON records keyed by `owner_id`, which is the patient
/// id, so the scoping is the record's own ownership rather than a filter over
/// everything.
#[get("/api/clinical/patient/{patient_id}/blood")]
pub async fn list_patient_blood(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::Blood).await
}

/// Every procedure performed on this patient.
///
/// Workflow 8 was the partial one. Pre-operative assessments, operative notes
/// and post-operative notes already had `/patient/{patient_id}` siblings; the
/// procedures done at the bedside and in the emergency department did not.
/// Intubation, a laceration repair, a splint or cast, a burn assessment and an
/// anaesthesia record were each reachable only by a record id.
///
/// These are returned together because "what was done to me" is one question.
/// Splitting it across five endpoints is how a screen comes to ask four of
/// them.
#[get("/api/clinical/patient/{patient_id}/procedures")]
pub async fn list_patient_procedures(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::Procedures).await
}

/// A discharge this patient took against medical advice.
///
/// Reachable only as `GET /api/clinical/ama/{ama_id}` and through
/// `GET /api/platform/list/ama-discharges`, the deployment register.
///
/// An AMA record states what the patient was told would happen if they left,
/// that they were judged to have capacity, and that they signed. It is the
/// document most likely to be cited *against* them later, which is exactly why
/// they should be able to read it.
#[get("/api/clinical/patient/{patient_id}/ama-discharges")]
pub async fn list_patient_ama_discharges(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::AmaDischarges).await
}

/// This patient's fluid balance.
///
/// Reachable only ward-wide, through `GET /api/nursing/intake-output` and
/// `GET /api/platform/list/intake-output`, both provider-only.
///
/// This is the least urgent of the listings here -- a patient rarely asks for
/// their fluid chart -- but it is the one a patient on dialysis, with heart
/// failure or on a fluid restriction is told to care about, and being told to
/// care about a number they cannot see is not a plan.
#[get("/api/clinical/patient/{patient_id}/intake-output")]
pub async fn list_patient_intake_output(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::IntakeOutput).await
}

/// The authorisation boundary for every patient-scoped document listing.
///
/// These routes share one `authorize`, so they are tested as one table rather
/// than as seven near-identical modules. The boundary matters more here than on
/// a clinician route, in both directions:
///
///   * **Refusing the patient is a defect, not a safe default.** `patient_id`
///     is a `PAT-` id and the caller id is a wallet address, so the obvious
///     comparison fails closed and locks a patient out of their own discharge
///     papers. `caller_owns_patient_record` is what bridges the two namespaces,
///     and this table exists so a refactor cannot quietly remove it.
///   * **Letting them read another patient is a disclosure.** A discharge
///     summary names a diagnosis; a pathology report names a cancer.
/// Why a medicine was not dispensed: every allergy decision a pharmacist
/// recorded about this patient, newest first.
///
/// These were readable only through `/api/pharmacy/allergy-decisions/patient/
/// {id}`, gated on clinical staff -- whose own doc comment said the patient's
/// copy was served here, which it was not. A patient whose medicine did not
/// arrive could not find out why. One route now serves both: the treating
/// team and the patient, through the same `authorize()`.
#[get("/api/clinical/patient/{patient_id}/pharmacy-decisions")]
pub async fn list_patient_pharmacy_decisions(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::PharmacyDecisions).await
}

/// The ambulance handovers recorded about this patient.
///
/// A handover is a record about the patient -- what happened at the scene,
/// what the crew gave them -- and was readable only by id, behind a clinical
/// gate (rule 10).
#[get("/api/clinical/patient/{patient_id}/ems-handoffs")]
pub async fn list_patient_ems_handoffs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    section_response(&data, &patient_id, RecordSection::EmsHandoffs).await
}

#[cfg(test)]
mod patient_document_access_tests {
    use crate::{AppState, Role, User};
    use actix_web::{test, web, App};

    /// Every patient-scoped listing this module serves.
    const ROUTES: &[&str] = &[
        "history-physicals",
        "progress-notes",
        "wounds",
        "discharges",
        "imaging",
        "pathology",
        "consults",
        "care-plans",
        "blood",
        "procedures",
        "ama-discharges",
        "intake-output",
        "pharmacy-decisions",
        "ems-handoffs",
    ];

    fn state_with(role: Role, wallet: &str, linked: Option<&str>) -> web::Data<AppState> {
        let state = AppState::new();
        let user = User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Test".to_string(),
            role,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: linked.map(str::to_string),
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        };
        state
            .users
            .write()
            .unwrap()
            .insert(wallet.to_string(), user);
        web::Data::new(state)
    }

    async fn status_for(
        data: web::Data<AppState>,
        wallet: &str,
        patient_id: &str,
        route: &str,
    ) -> u16 {
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::list_patient_history_physicals)
                .service(super::list_patient_progress_notes)
                .service(super::list_patient_wounds)
                .service(super::list_patient_discharges)
                .service(super::list_patient_imaging)
                .service(super::list_patient_pathology)
                .service(super::list_patient_consults)
                .service(super::list_patient_care_plans)
                .service(super::list_patient_blood)
                .service(super::list_patient_procedures)
                .service(super::list_patient_ama_discharges)
                .service(super::list_patient_intake_output)
                .service(super::list_patient_pharmacy_decisions)
                .service(super::list_patient_ems_handoffs),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/clinical/patient/{patient_id}/{route}"))
            .insert_header(("X-User-Id", wallet.to_string()))
            .to_request();
        test::call_service(&app, req).await.status().as_u16()
    }

    /// The whole point. Reaching your own record must not require a clinical
    /// role — `get_consult` and `get_radiology_report` both demand one, which is
    /// why the patient could not read those even holding the id.
    #[actix_rt::test]
    async fn a_patient_can_open_their_own_documents() {
        for route in ROUTES {
            let data = state_with(Role::Patient, "5Wallet-Own", Some("PAT-1"));
            assert_eq!(
                status_for(data, "5Wallet-Own", "PAT-1", route).await,
                200,
                "a patient was refused their own {route}"
            );
        }
    }

    #[actix_rt::test]
    async fn a_patient_cannot_open_someone_elses_documents() {
        for route in ROUTES {
            let data = state_with(Role::Patient, "5Wallet-Other", Some("PAT-2"));
            assert_eq!(
                status_for(data, "5Wallet-Other", "PAT-1", route).await,
                403,
                "one patient could read another's {route}"
            );
        }
    }

    /// The treating team reads the same record through the same route.
    #[actix_rt::test]
    async fn a_clinician_can_read_a_patients_documents() {
        for route in ROUTES {
            let data = state_with(Role::Doctor, "5Wallet-Doc", None);
            assert_eq!(
                status_for(data, "5Wallet-Doc", "PAT-1", route).await,
                200,
                "a clinician was refused a patient's {route}"
            );
        }
    }

    /// `X-User-Id` is caller-supplied, so it is resolved against the user store
    /// before any scoping decision. An unregistered wallet is not a caller.
    #[actix_rt::test]
    async fn an_unknown_caller_is_refused() {
        for route in ROUTES {
            let data = state_with(Role::Doctor, "5Wallet-Doc", None);
            assert_eq!(
                status_for(data, "5Nobody-At-All", "PAT-1", route).await,
                401,
                "a forged caller reached {route}"
            );
        }
    }
}

#[cfg(test)]
mod records_summary_tests {
    use super::*;
    use actix_web::{test, App};

    const PATIENT_ID: &str = "PAT-SUMMARY";
    const PATIENT: &str = "patient_summary";
    const OTHER: &str = "patient_other_summary";

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        for (wallet, linked) in [(PATIENT, PATIENT_ID), (OTHER, "PAT-ELSEWHERE")] {
            let mut user = crate::test_fixtures::staff(wallet, crate::Role::Patient);
            user.linked_patient_id = Some(linked.into());
            state.users.write().unwrap().insert(wallet.into(), user);
        }
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        web::Data::new(state)
    }

    async fn summary(
        data: &web::Data<AppState>,
        wallet: &str,
        query: &str,
    ) -> (u16, serde_json::Value) {
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(get_records_summary),
        )
        .await;
        let request = test::TestRequest::get()
            .uri(&format!(
                "/api/patients/{PATIENT_ID}/records-summary{query}"
            ))
            .insert_header(("x-user-id", wallet))
            .to_request();
        let response = test::call_service(&app, request).await;
        let status = response.status().as_u16();
        (status, test::read_body_json(response).await)
    }

    #[actix_web::test]
    async fn one_read_returns_every_section_in_its_own_endpoints_shape() {
        let data = state().await;
        let (status, body) = summary(&data, PATIENT, "").await;
        assert_eq!(status, 200);
        let sections = body["sections"].as_object().unwrap();
        assert_eq!(sections.len(), RecordSection::ALL.len());
        assert!(sections["discharges"]["summaries"].is_array());
        assert!(sections["vitals"]["readings"].is_array());
        assert_eq!(body["unavailable"], serde_json::json!([]));
        assert_eq!(body["per_page"], SUMMARY_DEFAULT_PER_PAGE);
    }

    #[actix_web::test]
    async fn paging_is_bounded_and_another_patient_is_refused() {
        let data = state().await;
        let (_, body) = summary(&data, PATIENT, "?page=2&per_page=10000").await;
        assert_eq!(body["per_page"], PAGE);
        assert_eq!(body["page"], 2);
        assert_eq!(summary(&data, OTHER, "").await.0, 403);
    }
}
