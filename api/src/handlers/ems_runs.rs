//! Ambulance run record: scan once, carry everything, hand over with one button.
//!
//! A run is one patient a crew attends. The crew taps as they work — on scene,
//! vitals, a medicine, leaving for a hospital — and each tap is an append-only
//! event. Choosing the destination when leaving the scene is the pre-alert: the
//! run appears on that hospital's incoming board at once. "Hand over" marks the
//! run arrived; one tap by the receiving clinician marks it received, and gives
//! them a care relationship so the chart opens straight into their workspace.
//! Design: docs/FRONTEND_WORKFLOW_AND_MOTION_PLAN.md §3.
//!
//! Status is a small state machine enforced here and committed with a guarded
//! write (`replace_if_field_eq`), so two people moving the same run cannot both
//! win (Hunt & Thomas, *The Pragmatic Programmer* p.240, on finite state
//! machines). Events are append-only, which is what makes queuing them on a
//! device without signal safe: an append conflicts with nothing, and a resend
//! under the same operation key is refused by the idempotency guard.
//!
//! The existing `ems_handoffs` records stay readable; new handovers are runs.

use super::*;
use crate::repositories::traits::{AccessLogEntity, JsonRecordEntity, RepositoryError};
use crate::websocket::{Audience, PushEvent};
use chrono::{DateTime, Duration};
use serde_json::Value;

/// Longest free-text field accepted (complaint, description, note).
const MAX_TEXT: usize = 2_000;
/// Largest event payload accepted, serialized.
const MAX_PAYLOAD_BYTES: usize = 8_192;
/// Most events one run may hold: a long transfer, never an unbounded log.
const MAX_EVENTS_PER_RUN: usize = 500;
/// Runs shown on a crew's own list.
const MAX_OWN_RUNS: usize = 50;

/// Where a run is in its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    InProgress,
    EnRoute,
    Arrived,
    Received,
    Cancelled,
    NoTransport,
}

impl RunStatus {
    fn as_str(self) -> &'static str {
        match self {
            RunStatus::InProgress => "in_progress",
            RunStatus::EnRoute => "en_route",
            RunStatus::Arrived => "arrived",
            RunStatus::Received => "received",
            RunStatus::Cancelled => "cancelled",
            RunStatus::NoTransport => "no_transport",
        }
    }

    fn is_closed(self) -> bool {
        matches!(
            self,
            RunStatus::Received | RunStatus::Cancelled | RunStatus::NoTransport
        )
    }
}

/// What the crew recorded. Clinical kinds append; the rest also move status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Dispatched,
    OnScene,
    PatientContact,
    Identified,
    Vitals,
    Treatment,
    Medication,
    Note,
    LeftScene,
    DestinationChanged,
    HandedOver,
    Received,
    Cancelled,
    NoTransport,
}

/// The status `kind` moves a run in `from` to: `Ok(None)` for an event that
/// only appends, `Err` for one that cannot happen from here.
pub fn transition(from: RunStatus, kind: EventKind) -> Result<Option<RunStatus>, &'static str> {
    use EventKind as K;
    use RunStatus as S;
    if from.is_closed() {
        return Err("This run is closed; nothing more can be recorded on it");
    }
    match (from, kind) {
        (S::InProgress, K::LeftScene) => Ok(Some(S::EnRoute)),
        (S::EnRoute, K::DestinationChanged) => Ok(Some(S::EnRoute)),
        (S::EnRoute, K::HandedOver) => Ok(Some(S::Arrived)),
        (S::EnRoute | S::Arrived, K::Received) => Ok(Some(S::Received)),
        (S::InProgress | S::EnRoute, K::Cancelled) => Ok(Some(S::Cancelled)),
        (S::InProgress, K::NoTransport) => Ok(Some(S::NoTransport)),
        (_, K::LeftScene) => Err("The crew has already left the scene"),
        (_, K::DestinationChanged) => Err("The destination can change only while en route"),
        (_, K::HandedOver) => Err("Choose a hospital and leave the scene before handing over"),
        (_, K::Received | K::Cancelled | K::NoTransport) => {
            Err("That cannot happen from the run's current status")
        }
        (_, _) => Ok(None),
    }
}

/// A run as stored (the `data` of its JSON record).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmsRun {
    pub id: String,
    pub status: RunStatus,
    pub created_by: String,
    #[serde(default)]
    pub crew: Vec<String>,
    pub unit_number: Option<String>,
    pub ems_agency: Option<String>,
    pub patient_id: Option<String>,
    /// For a casualty not yet identified ("man, about 40").
    pub unidentified_description: Option<String>,
    pub chief_complaint: Option<String>,
    pub incident_id: Option<String>,
    pub destination_facility_id: Option<String>,
    pub destination_name: Option<String>,
    pub eta: Option<DateTime<Utc>>,
    pub received_by: Option<String>,
    pub received_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One tap on the timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmsRunEvent {
    pub id: String,
    pub run_id: String,
    pub kind: EventKind,
    pub occurred_at: DateTime<Utc>,
    pub recorded_by: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Deserialize)]
pub struct CreateRunRequest {
    /// A device-chosen id (`RUN-` + 32 hex), so a run started with no signal
    /// can be queued together with its first entries. Stored insert-only
    /// (`create_if_absent`): a chosen id can never overwrite another run.
    pub id: Option<String>,
    pub unit_number: Option<String>,
    pub ems_agency: Option<String>,
    #[serde(default)]
    pub crew: Vec<String>,
    pub patient_id: Option<String>,
    pub unidentified_description: Option<String>,
    pub chief_complaint: Option<String>,
    pub incident_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddEventRequest {
    pub kind: EventKind,
    /// When it happened, if not now (a vitals set entered a minute late).
    pub occurred_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub payload: Value,
    /// Required for `left_scene` and `destination_changed`.
    pub destination_facility_id: Option<String>,
    /// Minutes to arrival, for `left_scene` and `destination_changed`.
    pub eta_minutes: Option<i64>,
    /// For `identified`: the patient the crew scanned.
    pub patient_id: Option<String>,
    /// The chief complaint, recorded or corrected at any point.
    pub chief_complaint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RunWithEvents {
    #[serde(flatten)]
    pub run: EmsRun,
    pub events: Vec<EmsRunEvent>,
}

fn refuse(status: actix_web::http::StatusCode, message: &str, code: &str) -> HttpResponse {
    HttpResponse::build(status).json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

fn unavailable(what: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("ems runs: {what}: {error}");
    refuse(
        actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
        "The ambulance record could not be reached; nothing was changed",
        "DATABASE_ERROR",
    )
}

fn bad_request(message: &str) -> HttpResponse {
    refuse(
        actix_web::http::StatusCode::BAD_REQUEST,
        message,
        "INVALID_RUN",
    )
}

/// Trimmed, bounded text, or `None` for a blank.
fn text(value: &Option<String>) -> Result<Option<String>, HttpResponse> {
    let Some(raw) = value.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if raw.chars().count() > MAX_TEXT {
        return Err(bad_request("A text field is longer than 2000 characters"));
    }
    Ok(Some(raw.to_string()))
}

fn run_record(run: &EmsRun) -> JsonRecordEntity {
    JsonRecordEntity {
        id: run.id.clone(),
        owner_id: run.created_by.clone(),
        data: serde_json::to_value(run).unwrap_or(Value::Null),
        created_at: run.created_at,
        updated_at: run.updated_at,
    }
}

fn run_from(record: &JsonRecordEntity) -> Option<EmsRun> {
    serde_json::from_value(record.data.clone()).ok()
}

fn event_from(record: &JsonRecordEntity) -> Option<EmsRunEvent> {
    serde_json::from_value(record.data.clone()).ok()
}

fn audit(caller: &crate::User, action: &str, run: &EmsRun) -> AccessLogEntity {
    AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: caller.id.clone(),
        accessor_role: caller.role.to_string(),
        patient_id: run.patient_id.clone(),
        resource_type: "ems_run".to_string(),
        resource_id: Some(run.id.clone()),
        action: action.to_string(),
        access_reason: Some("emergency workflow".to_string()),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        accessed_at: Utc::now(),
        facility_id: None,
        authority_type: None,
        authority_id: None,
    }
}

/// A patient id the crew attached must name a real patient. A lookup that
/// failed is not a patient who does not exist.
async fn check_patient(data: &web::Data<AppState>, patient_id: &str) -> Result<(), HttpResponse> {
    match data.repositories.patients.get_by_id(patient_id).await {
        Ok(_) => Ok(()),
        Err(RepositoryError::NotFound(_)) => Err(refuse(
            actix_web::http::StatusCode::NOT_FOUND,
            "No patient has that id",
            "PATIENT_NOT_FOUND",
        )),
        Err(e) => Err(unavailable("patient lookup", e)),
    }
}

/// Active real facilities as (id, name): the database when there is one,
/// otherwise the facilities staff are assigned to.
async fn destinations(data: &web::Data<AppState>) -> Result<Vec<(String, String)>, HttpResponse> {
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(data.identity_contexts.assigned_facilities());
    };
    sqlx::query_as::<_, (String, String)>(
        "SELECT id, name FROM facilities WHERE status = 'active' AND id <> $1 ORDER BY name LIMIT 200",
    )
    .bind("legacy-facility")
    .fetch_all(pool)
    .await
    .map_err(|e| unavailable("facility list", e))
}

/// The destination's display name, or a refusal when it is not a facility.
async fn destination_name(
    data: &web::Data<AppState>,
    facility_id: &str,
) -> Result<String, HttpResponse> {
    let known = destinations(data).await?;
    known
        .into_iter()
        .find(|(id, _)| id == facility_id)
        .map(|(_, name)| name)
        .ok_or_else(|| bad_request("That destination is not an active facility"))
}

async fn load_run(data: &web::Data<AppState>, run_id: &str) -> Result<EmsRun, HttpResponse> {
    match data.repositories.ems_runs.get_by_id(run_id).await {
        Ok(Some(record)) => run_from(&record)
            .ok_or_else(|| unavailable("run decode", format!("run {run_id} is unreadable"))),
        Ok(None) => Err(refuse(
            actix_web::http::StatusCode::NOT_FOUND,
            "No such ambulance run",
            "RUN_NOT_FOUND",
        )),
        Err(e) => Err(unavailable("run read", e)),
    }
}

async fn load_events(
    data: &web::Data<AppState>,
    run_id: &str,
) -> Result<Vec<EmsRunEvent>, HttpResponse> {
    let records = data
        .repositories
        .ems_run_events
        .get_by_owner(run_id)
        .await
        .map_err(|e| unavailable("event read", e))?;
    let mut events: Vec<EmsRunEvent> = records.iter().filter_map(event_from).collect();
    events.sort_by_key(|e| e.occurred_at);
    Ok(events)
}

/// Who may read a run: its crew member, staff at its destination, an admin.
fn may_read(data: &web::Data<AppState>, caller: &crate::User, run: &EmsRun) -> bool {
    if caller.id == run.created_by || caller.role == Role::Admin {
        return true;
    }
    let here = data.identity_contexts.facility_id_for_user(&caller.id);
    caller.role.can_view_medical_records() && here.is_some() && here == run.destination_facility_id
}

/// Tell the destination's staff a patient is coming (best effort: the board
/// also refreshes on its own, so a missed push is never a missed patient).
fn announce(data: &web::Data<AppState>, run: &EmsRun) {
    let Some(facility) = run.destination_facility_id.as_deref() else {
        return;
    };
    let accounts = data.identity_contexts.users_at_facility(facility);
    if accounts.is_empty() {
        return;
    }
    data.ws_manager.push_event(PushEvent {
        event_type: "ems_incoming".to_string(),
        patient_id: None,
        payload: serde_json::json!({ "run_id": run.id, "status": run.status.as_str(), "eta": run.eta }),
        timestamp: Utc::now().timestamp(),
        audience: Audience::Accounts(accounts),
    });
}

/// Start a run (the crew's first tap after a call or a scan).
#[post("/api/ems/runs")]
pub async fn create_ems_run(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<CreateRunRequest>,
) -> impl Responder {
    let caller = match crate::support::require_ems_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let request = body.into_inner();
    let run = match new_run(&data, &caller, &request).await {
        Ok(run) => run,
        Err(response) => return response,
    };
    if let Err(response) =
        crate::support::require_durable_audit(&data, audit(&caller, "create_ems_handoff", &run))
            .await
    {
        return response;
    }
    match data
        .repositories
        .ems_runs
        .create_if_absent(run_record(&run))
        .await
    {
        Ok(Some(_)) => HttpResponse::Created().json(RunWithEvents {
            run,
            events: Vec::new(),
        }),
        Ok(None) => refuse(
            actix_web::http::StatusCode::CONFLICT,
            "A run with that id already exists",
            "RUN_EXISTS",
        ),
        Err(e) => unavailable("run create", e),
    }
}

async fn new_run(
    data: &web::Data<AppState>,
    caller: &crate::User,
    request: &CreateRunRequest,
) -> Result<EmsRun, HttpResponse> {
    let patient_id = text(&request.patient_id)?;
    if let Some(patient) = &patient_id {
        check_patient(data, patient).await?;
    }
    if request.crew.len() > 10 || request.crew.iter().any(|c| c.chars().count() > 128) {
        return Err(bad_request(
            "List at most ten crew members, each under 128 characters",
        ));
    }
    let now = Utc::now();
    let id = match request.id.as_deref() {
        Some(chosen) if is_run_id(chosen) => chosen.to_string(),
        Some(_) => {
            return Err(bad_request(
                "A run id is RUN- followed by 32 hexadecimal characters",
            ))
        }
        None => format!("RUN-{}", uuid::Uuid::new_v4().simple()),
    };
    Ok(EmsRun {
        id,
        status: RunStatus::InProgress,
        created_by: caller.id.clone(),
        crew: request
            .crew
            .iter()
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .collect(),
        unit_number: text(&request.unit_number)?,
        ems_agency: text(&request.ems_agency)?,
        patient_id,
        unidentified_description: text(&request.unidentified_description)?,
        chief_complaint: text(&request.chief_complaint)?,
        incident_id: text(&request.incident_id)?,
        destination_facility_id: None,
        destination_name: None,
        eta: None,
        received_by: None,
        received_at: None,
        created_at: now,
        updated_at: now,
    })
}

/// `RUN-` followed by exactly 32 lowercase hexadecimal characters.
fn is_run_id(value: &str) -> bool {
    value.strip_prefix("RUN-").is_some_and(|hex| {
        hex.len() == 32
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

/// The crew's own runs, newest first.
#[get("/api/ems/runs")]
pub async fn list_own_ems_runs(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let caller = match crate::support::require_ems_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    match data.repositories.ems_runs.get_by_owner(&caller.id).await {
        Ok(records) => {
            let runs: Vec<EmsRun> = records
                .iter()
                .filter_map(run_from)
                .take(MAX_OWN_RUNS)
                .collect();
            HttpResponse::Ok().json(serde_json::json!({ "runs": runs }))
        }
        Err(e) => unavailable("own runs", e),
    }
}

/// Facilities a crew can take a patient to.
#[get("/api/ems/destinations")]
pub async fn list_ems_destinations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(response) = crate::support::require_ems_staff(&data, &http_req) {
        return response;
    }
    match destinations(&data).await {
        Ok(list) => {
            let facilities: Vec<Value> = list
                .into_iter()
                .map(|(id, name)| serde_json::json!({ "id": id, "name": name }))
                .collect();
            HttpResponse::Ok().json(serde_json::json!({ "facilities": facilities }))
        }
        Err(response) => response,
    }
}

/// One run with its whole timeline.
#[get("/api/ems/runs/{run_id}")]
pub async fn get_ems_run(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let run = match load_run(&data, &path.into_inner()).await {
        Ok(run) => run,
        Err(response) => return response,
    };
    if !may_read(&data, &caller, &run) {
        return refuse(
            actix_web::http::StatusCode::FORBIDDEN,
            "This ambulance record is not yours to read",
            "RUN_FORBIDDEN",
        );
    }
    if caller.id != run.created_by {
        if let Err(response) =
            crate::support::require_durable_audit(&data, audit(&caller, "view", &run)).await
        {
            return response;
        }
    }
    match load_events(&data, &run.id).await {
        Ok(events) => HttpResponse::Ok().json(RunWithEvents { run, events }),
        Err(response) => response,
    }
}

/// Record one tap on the timeline; some taps also move the run's status.
#[post("/api/ems/runs/{run_id}/events")]
pub async fn add_ems_run_event(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<AddEventRequest>,
) -> impl Responder {
    let caller = match crate::support::require_ems_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let request = body.into_inner();
    if matches!(request.kind, EventKind::Received) {
        return bad_request("Receipt is recorded by the hospital, at /receive");
    }
    let run = match load_run(&data, &path.into_inner()).await {
        Ok(run) => run,
        Err(response) => return response,
    };
    if run.created_by != caller.id {
        return refuse(
            actix_web::http::StatusCode::FORBIDDEN,
            "Only the crew member who started this run can add to it",
            "RUN_FORBIDDEN",
        );
    }
    let next = match plan_event(&data, &run, &request).await {
        Ok(next) => next,
        Err(response) => return response,
    };
    commit_event(&data, &caller, run, next, &request).await
}

/// The run as it will be after `request`, checked against the state machine.
async fn plan_event(
    data: &web::Data<AppState>,
    run: &EmsRun,
    request: &AddEventRequest,
) -> Result<EmsRun, HttpResponse> {
    let target = transition(run.status, request.kind)
        .map_err(|m| refuse(actix_web::http::StatusCode::CONFLICT, m, "RUN_STATE"))?;
    if serde_json::to_vec(&request.payload)
        .map(|b| b.len())
        .unwrap_or(usize::MAX)
        > MAX_PAYLOAD_BYTES
    {
        return Err(bad_request("That entry is too large"));
    }
    let mut next = run.clone();
    next.updated_at = Utc::now();
    if let Some(status) = target {
        next.status = status;
    }
    if let Some(complaint) = text(&request.chief_complaint)? {
        next.chief_complaint = Some(complaint);
    }
    if matches!(
        request.kind,
        EventKind::LeftScene | EventKind::DestinationChanged
    ) {
        let facility = text(&request.destination_facility_id)?
            .ok_or_else(|| bad_request("Choose the hospital the patient is going to"))?;
        next.destination_name = Some(destination_name(data, &facility).await?);
        next.destination_facility_id = Some(facility);
        next.eta = request
            .eta_minutes
            .filter(|m| (0..=24 * 60).contains(m))
            .map(|m| Utc::now() + Duration::minutes(m));
    }
    if matches!(request.kind, EventKind::Identified) {
        let patient =
            text(&request.patient_id)?.ok_or_else(|| bad_request("Scan or choose the patient"))?;
        check_patient(data, &patient).await?;
        next.patient_id = Some(patient);
    }
    Ok(next)
}

async fn commit_event(
    data: &web::Data<AppState>,
    caller: &crate::User,
    run: EmsRun,
    next: EmsRun,
    request: &AddEventRequest,
) -> HttpResponse {
    let existing = match data.repositories.ems_run_events.get_by_owner(&run.id).await {
        Ok(list) => list.len(),
        Err(e) => return unavailable("event count", e),
    };
    if existing >= MAX_EVENTS_PER_RUN {
        return bad_request("This run's timeline is full");
    }
    if let Err(response) =
        crate::support::require_durable_audit(data, audit(caller, "create_ems_handoff", &next))
            .await
    {
        return response;
    }
    let changed = run.status != next.status
        || run.destination_facility_id != next.destination_facility_id
        || run.patient_id != next.patient_id
        || run.chief_complaint != next.chief_complaint;
    if changed {
        match data
            .repositories
            .ems_runs
            .replace_if_field_eq(&run.id, "status", run.status.as_str(), run_record(&next))
            .await
        {
            Ok(Some(_)) => {}
            Ok(None) => {
                return refuse(
                    actix_web::http::StatusCode::CONFLICT,
                    "Someone else changed this run; reload it",
                    "RUN_STATE_CHANGED",
                )
            }
            Err(e) => return unavailable("run update", e),
        }
    }
    let event = EmsRunEvent {
        id: format!("RUNEV-{}", uuid::Uuid::new_v4().simple()),
        run_id: run.id.clone(),
        kind: request.kind,
        occurred_at: request
            .occurred_at
            .filter(|t| *t <= Utc::now() + Duration::minutes(5))
            .unwrap_or_else(Utc::now),
        recorded_by: caller.id.clone(),
        payload: request.payload.clone(),
    };
    let record = JsonRecordEntity {
        id: event.id.clone(),
        owner_id: run.id.clone(),
        data: serde_json::to_value(&event).unwrap_or(Value::Null),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    if let Err(e) = data
        .repositories
        .ems_run_events
        .create_if_absent(record)
        .await
    {
        return unavailable("event append", e);
    }
    if matches!(
        request.kind,
        EventKind::LeftScene | EventKind::DestinationChanged | EventKind::HandedOver
    ) {
        announce(data, &next);
    }
    HttpResponse::Created().json(serde_json::json!({ "run": next, "event": event }))
}

/// Runs coming to the caller's facility (en route or arrived): the ED board.
#[get("/api/ems/incoming")]
pub async fn list_incoming_ems_runs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let Some(facility) = data.identity_contexts.facility_id_for_user(&caller.id) else {
        return HttpResponse::Ok()
            .json(serde_json::json!({ "facility_id": Value::Null, "runs": [] }));
    };
    let records = match data
        .repositories
        .ems_runs
        .get_by_data_field("destination_facility_id", &facility)
        .await
    {
        Ok(records) => records,
        Err(e) => return unavailable("incoming runs", e),
    };
    let active: Vec<EmsRun> = records
        .iter()
        .filter_map(run_from)
        .filter(|r| matches!(r.status, RunStatus::EnRoute | RunStatus::Arrived))
        .take(50)
        .collect();
    let mut runs = Vec::with_capacity(active.len());
    for run in active {
        if let Err(response) =
            crate::support::require_durable_audit(&data, audit(&caller, "view", &run)).await
        {
            return response;
        }
        match load_events(&data, &run.id).await {
            Ok(events) => runs.push(RunWithEvents { run, events }),
            Err(response) => return response,
        }
    }
    HttpResponse::Ok().json(serde_json::json!({ "facility_id": facility, "runs": runs }))
}

/// One tap by the receiving clinician: the run is received, and they may
/// open the patient's chart (an encounter care relationship).
#[post("/api/ems/runs/{run_id}/receive")]
pub async fn receive_ems_run(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let run = match load_run(&data, &path.into_inner()).await {
        Ok(run) => run,
        Err(response) => return response,
    };
    let here = data.identity_contexts.facility_id_for_user(&caller.id);
    if here.is_none() || here != run.destination_facility_id {
        return refuse(
            actix_web::http::StatusCode::FORBIDDEN,
            "Only staff at the destination hospital can receive this patient",
            "RUN_FORBIDDEN",
        );
    }
    let target = match transition(run.status, EventKind::Received) {
        Ok(Some(status)) => status,
        Ok(None) | Err(_) => {
            return refuse(
                actix_web::http::StatusCode::CONFLICT,
                "This run cannot be received from its current status",
                "RUN_STATE",
            )
        }
    };
    let mut next = run.clone();
    next.status = target;
    next.received_by = Some(caller.id.clone());
    next.received_at = Some(Utc::now());
    next.updated_at = Utc::now();
    if let Err(response) =
        crate::support::require_durable_audit(&data, audit(&caller, "Update", &next)).await
    {
        return response;
    }
    match data
        .repositories
        .ems_runs
        .replace_if_field_eq(&run.id, "status", run.status.as_str(), run_record(&next))
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            return refuse(
                actix_web::http::StatusCode::CONFLICT,
                "Someone else changed this run; reload it",
                "RUN_STATE_CHANGED",
            )
        }
        Err(e) => return unavailable("run receive", e),
    }
    let event = EmsRunEvent {
        id: format!("RUNEV-{}", uuid::Uuid::new_v4().simple()),
        run_id: run.id.clone(),
        kind: EventKind::Received,
        occurred_at: Utc::now(),
        recorded_by: caller.id.clone(),
        payload: Value::Null,
    };
    let record = JsonRecordEntity {
        id: event.id.clone(),
        owner_id: run.id.clone(),
        data: serde_json::to_value(&event).unwrap_or(Value::Null),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    if let Err(e) = data
        .repositories
        .ems_run_events
        .create_if_absent(record)
        .await
    {
        log::error!("ems runs: receipt event not appended for {}: {e}", run.id);
    }
    if let Some(patient) = next.patient_id.as_deref() {
        crate::care_access::record_encounter(&data, patient, &caller.id, &run.id, Utc::now()).await;
    }
    HttpResponse::Ok().json(serde_json::json!({ "run": next }))
}

/// The ambulance runs recorded about one patient, with their timelines.
pub async fn runs_for_patient(
    data: &AppState,
    patient_id: &str,
) -> Result<Vec<RunWithEvents>, RepositoryError> {
    let records = data
        .repositories
        .ems_runs
        .get_by_data_field("patient_id", patient_id)
        .await?;
    let mut out = Vec::new();
    for run in records.iter().filter_map(run_from).take(MAX_OWN_RUNS) {
        let mut events: Vec<EmsRunEvent> = data
            .repositories
            .ems_run_events
            .get_by_owner(&run.id)
            .await?
            .iter()
            .filter_map(event_from)
            .collect();
        events.sort_by_key(|e| e.occurred_at);
        out.push(RunWithEvents { run, events });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use EventKind as K;
    use RunStatus as S;

    #[test]
    fn a_run_moves_scene_to_road_to_hospital_to_receipt() {
        assert_eq!(transition(S::InProgress, K::Vitals), Ok(None));
        assert_eq!(
            transition(S::InProgress, K::LeftScene),
            Ok(Some(S::EnRoute))
        );
        assert_eq!(transition(S::EnRoute, K::Medication), Ok(None));
        assert_eq!(
            transition(S::EnRoute, K::DestinationChanged),
            Ok(Some(S::EnRoute))
        );
        assert_eq!(transition(S::EnRoute, K::HandedOver), Ok(Some(S::Arrived)));
        assert_eq!(transition(S::Arrived, K::Received), Ok(Some(S::Received)));
    }

    #[test]
    fn a_hospital_can_receive_a_patient_the_crew_has_not_yet_marked_arrived() {
        assert_eq!(transition(S::EnRoute, K::Received), Ok(Some(S::Received)));
    }

    #[test]
    fn nothing_is_recorded_on_a_closed_run() {
        for closed in [S::Received, S::Cancelled, S::NoTransport] {
            for kind in [K::Vitals, K::Note, K::HandedOver, K::Received, K::LeftScene] {
                assert!(
                    transition(closed, kind).is_err(),
                    "{closed:?} accepted {kind:?}"
                );
            }
        }
    }

    #[test]
    fn handing_over_requires_leaving_the_scene_first() {
        assert!(transition(S::InProgress, K::HandedOver).is_err());
        assert!(transition(S::InProgress, K::Received).is_err());
    }

    #[test]
    fn the_crew_cannot_leave_the_scene_twice_or_redirect_before_leaving() {
        assert!(transition(S::EnRoute, K::LeftScene).is_err());
        assert!(transition(S::InProgress, K::DestinationChanged).is_err());
    }

    #[test]
    fn a_patient_who_refuses_transport_closes_the_run_from_the_scene_only() {
        assert_eq!(
            transition(S::InProgress, K::NoTransport),
            Ok(Some(S::NoTransport))
        );
        assert!(transition(S::EnRoute, K::NoTransport).is_err());
    }
}

#[cfg(test)]
mod api_tests {
    //! The whole run, end to end, through the real handlers: a crew records,
    //! leaves for one hospital, hands over; only that hospital sees it and can
    //! receive it; then nothing more can be written to it.
    use crate::{test_fixtures, AppState, Role};
    use actix_web::{test, web, App};
    use serde_json::{json, Value};

    const MEDIC: &str = "medic-run-1";
    const ED_NURSE: &str = "ed-nurse-run-1";
    const OTHER_NURSE: &str = "other-nurse-run-1";
    const PATIENT: &str = "PAT-RUN-1";

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        test_fixtures::register(&state, MEDIC, Role::Paramedic);
        test_fixtures::register(&state, ED_NURSE, Role::Nurse);
        test_fixtures::register(&state, OTHER_NURSE, Role::Nurse);
        test_fixtures::seed_patient(&state, PATIENT).await;
        state.identity_contexts.assign_professional_facility(
            ED_NURSE,
            "org-1",
            "fac-riverside",
            "Riverside District Hospital",
            "Nurse",
        );
        state.identity_contexts.assign_professional_facility(
            OTHER_NURSE,
            "org-1",
            "fac-northgate",
            "Northgate Regional",
            "Nurse",
        );
        web::Data::new(state)
    }

    macro_rules! app {
        ($data:expr) => {
            test::init_service(
                App::new()
                    .app_data($data.clone())
                    .service(super::list_own_ems_runs)
                    .service(super::list_ems_destinations)
                    .service(super::list_incoming_ems_runs)
                    .service(super::create_ems_run)
                    .service(super::get_ems_run)
                    .service(super::add_ems_run_event)
                    .service(super::receive_ems_run),
            )
            .await
        };
    }

    /// A macro, not a function: the service type is over `actix_http::Request`,
    /// which this crate cannot name (see `order_sets.rs`).
    macro_rules! call {
        ($app:expr, $user:expr, $method:expr, $uri:expr, $body:expr) => {{
            let req = match $method {
                "GET" => test::TestRequest::get(),
                _ => test::TestRequest::post().set_json(&$body),
            }
            .uri($uri)
            .insert_header(test_fixtures::as_user($user))
            .to_request();
            let resp = test::call_service(&$app, req).await;
            let status = resp.status().as_u16();
            let bytes = test::read_body(resp).await;
            let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            (status, body)
        }};
    }

    #[actix_rt::test]
    async fn a_run_reaches_only_its_hospital_and_closes_on_receipt() {
        let data = state().await;
        let app = app!(data);
        let (status, run) = call!(
            app,
            MEDIC,
            "POST",
            "/api/ems/runs",
            json!({ "patient_id": PATIENT, "chief_complaint": "Car crash, driver" })
        );
        assert_eq!(status, 201, "{run}");
        let id = run["id"].as_str().unwrap().to_string();
        let events = format!("/api/ems/runs/{id}/events");

        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            &events,
            json!({ "kind": "vitals", "payload": { "systolic_bp": 92, "heart_rate": 118 } })
        );
        assert_eq!(status, 201);
        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            &events,
            json!({ "kind": "handed_over" })
        );
        assert_eq!(status, 409, "handed over before leaving the scene");

        let (status, body) = call!(
            app,
            MEDIC,
            "POST",
            &events,
            json!({ "kind": "left_scene", "destination_facility_id": "fac-riverside", "eta_minutes": 10 })
        );
        assert_eq!(status, 201, "{body}");
        assert_eq!(body["run"]["status"], "en_route");
        assert_eq!(
            body["run"]["destination_name"],
            "Riverside District Hospital"
        );

        let (_, board) = call!(app, ED_NURSE, "GET", "/api/ems/incoming", Value::Null);
        assert_eq!(
            board["runs"].as_array().unwrap().len(),
            1,
            "the destination's board shows the run"
        );
        assert!(
            board["runs"][0]["events"].as_array().unwrap().len() >= 2,
            "with its timeline"
        );
        let (_, elsewhere) = call!(app, OTHER_NURSE, "GET", "/api/ems/incoming", Value::Null);
        assert_eq!(
            elsewhere["runs"].as_array().unwrap().len(),
            0,
            "another hospital never sees it"
        );
        let (status, _) = call!(
            app,
            OTHER_NURSE,
            "GET",
            &format!("/api/ems/runs/{id}"),
            Value::Null
        );
        assert_eq!(status, 403);

        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            &events,
            json!({ "kind": "handed_over" })
        );
        assert_eq!(status, 201);
        let (status, _) = call!(
            app,
            OTHER_NURSE,
            "POST",
            &format!("/api/ems/runs/{id}/receive"),
            json!({})
        );
        assert_eq!(status, 403, "only the destination receives");
        let (status, body) = call!(
            app,
            ED_NURSE,
            "POST",
            &format!("/api/ems/runs/{id}/receive"),
            json!({})
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["run"]["status"], "received");
        assert_eq!(body["run"]["received_by"], ED_NURSE);

        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            &events,
            json!({ "kind": "note", "payload": { "text": "late" } })
        );
        assert_eq!(status, 409, "a received run is closed");
        let (_, board) = call!(app, ED_NURSE, "GET", "/api/ems/incoming", Value::Null);
        assert_eq!(
            board["runs"].as_array().unwrap().len(),
            0,
            "received runs leave the board"
        );
    }

    #[actix_rt::test]
    async fn only_the_crew_member_who_started_a_run_can_add_to_it() {
        let data = state().await;
        test_fixtures::register(&data, "medic-run-2", Role::Paramedic);
        let app = app!(data);
        let (_, run) = call!(app, MEDIC, "POST", "/api/ems/runs", json!({}));
        let id = run["id"].as_str().unwrap();
        let (status, _) = call!(
            app,
            "medic-run-2",
            "POST",
            &format!("/api/ems/runs/{id}/events"),
            json!({ "kind": "note", "payload": { "text": "x" } })
        );
        assert_eq!(status, 403);
    }

    #[actix_rt::test]
    async fn leaving_for_somewhere_that_is_not_a_facility_is_refused() {
        let data = state().await;
        let app = app!(data);
        let (_, run) = call!(app, MEDIC, "POST", "/api/ems/runs", json!({}));
        let id = run["id"].as_str().unwrap();
        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            &format!("/api/ems/runs/{id}/events"),
            json!({ "kind": "left_scene", "destination_facility_id": "nowhere" })
        );
        assert_eq!(status, 400);
        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            &format!("/api/ems/runs/{id}/events"),
            json!({ "kind": "left_scene" })
        );
        assert_eq!(status, 400, "a destination is required");
    }

    #[actix_rt::test]
    async fn a_device_chosen_id_is_accepted_once_and_never_overwrites() {
        let data = state().await;
        let app = app!(data);
        let id = "RUN-0123456789abcdef0123456789abcdef";
        let (status, body) = call!(app, MEDIC, "POST", "/api/ems/runs", json!({ "id": id }));
        assert_eq!(status, 201, "{body}");
        assert_eq!(body["id"], id);
        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            "/api/ems/runs",
            json!({ "id": id, "chief_complaint": "replaced" })
        );
        assert_eq!(status, 409, "a second run cannot take an existing id");
        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            "/api/ems/runs",
            json!({ "id": "PAT-123" })
        );
        assert_eq!(status, 400, "only run-shaped ids are accepted");
    }

    #[actix_rt::test]
    async fn a_patient_who_does_not_exist_cannot_be_attached() {
        let data = state().await;
        let app = app!(data);
        let (status, _) = call!(
            app,
            MEDIC,
            "POST",
            "/api/ems/runs",
            json!({ "patient_id": "PAT-NOBODY" })
        );
        assert_eq!(status, 404);
    }
}
