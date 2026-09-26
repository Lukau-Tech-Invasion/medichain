//! Blood-unit stock inventory (WP7.5).
//!
//! Blood-bank staff (laboratory technicians and administrators) receive units
//! into stock, reserve a unit for a patient after crossmatch, release it back,
//! issue it against that patient's transfusion record, or discard it. Every
//! act is audited in the same transaction as the change, reservations are
//! checked for ABO/Rh compatibility with the patient's recorded group, and
//! the database refuses an expired unit being reserved or issued.
//! Clinical staff can read the stock, with expiry and low-stock alerts.

use super::*;
use crate::blood_inventory::{compatible, effective_status, summarise};
use crate::repositories::blood_units::{BloodUnitEntity, UnitTransition};

/// Longest storage location, in characters.
const MAX_LOCATION_CHARS: usize = 120;
/// Crossmatch reference length bounds, in characters.
const MAX_CROSSMATCH_CHARS: usize = 64;
/// Discard reason length bounds, in characters.
const MIN_DISCARD_REASON_CHARS: usize = 5;
const MAX_DISCARD_REASON_CHARS: usize = 500;
/// Longest shelf life accepted between collection and expiry (frozen plasma
/// keeps for up to a year; anything longer is a data-entry error).
const MAX_SHELF_LIFE_DAYS: i64 = 366;

/// Blood products held in stock.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum BloodProduct {
    PackedRBC,
    /// Fresh frozen plasma; `FFP` on the wire, as the rest of the API names it.
    #[serde(rename = "FFP")]
    Ffp,
    Platelets,
    Cryoprecipitate,
    WholeBlood,
}

impl BloodProduct {
    fn as_str(self) -> &'static str {
        match self {
            Self::PackedRBC => "PackedRBC",
            Self::Ffp => "FFP",
            Self::Platelets => "Platelets",
            Self::Cryoprecipitate => "Cryoprecipitate",
            Self::WholeBlood => "WholeBlood",
        }
    }
}

/// ABO group of a unit.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum AboGroup {
    A,
    B,
    AB,
    O,
}

impl AboGroup {
    fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::B => "B",
            Self::AB => "AB",
            Self::O => "O",
        }
    }
}

/// Rh type of a unit.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RhType {
    Positive,
    Negative,
}

impl RhType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Positive => "positive",
            Self::Negative => "negative",
        }
    }
}

/// Body of `POST /api/blood-bank/units`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiveUnitBody {
    pub unit_number: String,
    pub product_type: BloodProduct,
    pub abo: AboGroup,
    pub rh: RhType,
    pub collected_on: chrono::NaiveDate,
    pub expires_on: chrono::NaiveDate,
    pub location: String,
}

/// Body of `POST /api/blood-bank/units/{id}/reserve`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReserveUnitBody {
    pub patient_id: String,
    pub crossmatch_reference: String,
}

/// Body of `POST /api/blood-bank/units/{id}/issue`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssueUnitBody {
    pub transfusion_id: String,
}

/// Body of `POST /api/blood-bank/units/{id}/discard`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscardUnitBody {
    pub reason: String,
}

/// A JSON error with a stable code.
fn unit_error(
    mut builder: actix_web::HttpResponseBuilder,
    message: &str,
    code: &str,
) -> HttpResponse {
    builder.json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// 503 for a storage failure; the underlying error is logged, never returned.
fn unit_unavailable(context: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("Blood inventory: {context}: {error}");
    unit_error(
        HttpResponse::ServiceUnavailable(),
        "Blood inventory is temporarily unavailable.",
        "BLOOD_INVENTORY_UNAVAILABLE",
    )
}

/// Blood-bank acts are for laboratory technicians and administrators.
///
/// Parameters: the already-authenticated clinical caller. Returns a 403 for
/// any other role.
fn ensure_blood_bank_role(caller: &crate::User) -> Result<(), HttpResponse> {
    if matches!(caller.role, crate::Role::LabTechnician | crate::Role::Admin) {
        return Ok(());
    }
    Err(unit_error(
        HttpResponse::Forbidden(),
        "Only blood-bank staff can change blood stock.",
        "BLOOD_BANK_STAFF_REQUIRED",
    ))
}

/// Trim free text, refuse control characters, and check its length.
fn clean_field(raw: &str, min: usize, max: usize) -> Option<String> {
    let trimmed = raw.trim();
    let length = trimmed.chars().count();
    ((min..=max).contains(&length) && !trimmed.chars().any(char::is_control))
        .then(|| trimmed.to_string())
}

/// The audit row for a blood-unit act.
fn unit_audit(
    caller: &crate::User,
    unit_id: &str,
    patient_id: Option<&str>,
    action: &str,
) -> AccessLogEntity {
    AccessLogEntity {
        id: secure_tokens::generate_access_id(),
        accessor_id: caller.wallet_address.clone(),
        accessor_role: caller.role.to_string(),
        patient_id: patient_id.map(str::to_string),
        resource_type: "blood_unit".to_string(),
        resource_id: Some(unit_id.to_string()),
        action: action.to_string(),
        access_reason: None,
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: Utc::now(),
        facility_id: None,
    }
}

/// A unit as the API shows it: its stored fields and its effective status.
fn unit_view(unit: &BloodUnitEntity, today: chrono::NaiveDate) -> serde_json::Value {
    let mut value = serde_json::to_value(unit).unwrap_or(serde_json::Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "status".into(),
            serde_json::json!(effective_status(unit, today)),
        );
    }
    value
}

/// Stock, alerts and every unit (clinical staff).
#[get("/api/blood-bank/units")]
pub async fn list_blood_units(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(response) = require_clinical_staff(&data, &http_req) {
        return response;
    }
    let units = match data.repositories.blood_units.list().await {
        Ok(units) => units,
        Err(error) => return unit_unavailable("list", error),
    };
    let today = Utc::now().date_naive();
    let views: Vec<_> = units.iter().map(|unit| unit_view(unit, today)).collect();
    HttpResponse::Ok().json(
        serde_json::json!({ "success": true, "units": views, "summary": summarise(&units, today) }),
    )
}

/// Validate a received unit and build its row, or answer 400.
fn received_unit(
    body: ReceiveUnitBody,
    caller: &crate::User,
) -> Result<BloodUnitEntity, HttpResponse> {
    let invalid =
        |message: &str| unit_error(HttpResponse::BadRequest(), message, "INVALID_BLOOD_UNIT");
    let unit_number = body.unit_number.trim().to_ascii_uppercase();
    let number_ok = (5..=32).contains(&unit_number.len())
        && unit_number
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !number_ok {
        return Err(invalid(
            "The unit number must be 5 to 32 letters, digits or dashes.",
        ));
    }
    let shelf_life = (body.expires_on - body.collected_on).num_days();
    if !(0..=MAX_SHELF_LIFE_DAYS).contains(&shelf_life) {
        return Err(invalid(
            "The expiry date must be on or after collection, and within a year of it.",
        ));
    }
    let Some(location) = clean_field(&body.location, 1, MAX_LOCATION_CHARS) else {
        return Err(invalid("Give a storage location of up to 120 characters."));
    };
    let now = Utc::now();
    Ok(BloodUnitEntity {
        id: format!("BU-{}", Uuid::new_v4()),
        unit_number,
        product_type: body.product_type.as_str().into(),
        abo: body.abo.as_str().into(),
        rh: body.rh.as_str().into(),
        collected_on: body.collected_on,
        expires_on: body.expires_on,
        status: "available".into(),
        location,
        reserved_for_patient_id: None,
        crossmatch_reference: None,
        reserved_at: None,
        issued_to_patient_id: None,
        transfusion_id: None,
        issued_at: None,
        discard_reason: None,
        received_by: caller.wallet_address.clone(),
        created_at: now,
        updated_at: now,
    })
}

/// Receive a unit into stock (blood-bank staff). 201, 400, 409 duplicate.
#[post("/api/blood-bank/units")]
pub async fn receive_blood_unit(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<ReceiveUnitBody>,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if let Err(response) = ensure_blood_bank_role(&caller) {
        return response;
    }
    let unit = match received_unit(body.into_inner(), &caller) {
        Ok(unit) => unit,
        Err(response) => return response,
    };
    let audit = unit_audit(&caller, &unit.id, None, "blood_unit_received");
    match data.repositories.receive_blood_unit(unit, audit).await {
        Ok(stored) => HttpResponse::Created().json(serde_json::json!({ "success": true, "unit": unit_view(&stored, Utc::now().date_naive()) })),
        Err(crate::repositories::RepositoryError::Duplicate(_)) => unit_error(HttpResponse::Conflict(), "A unit with this number is already in stock records.", "DUPLICATE_UNIT_NUMBER"),
        Err(error) => unit_unavailable("receive", error),
    }
}

/// Load a unit: 404 if unknown.
async fn load_unit(data: &web::Data<AppState>, id: &str) -> Result<BloodUnitEntity, HttpResponse> {
    match data.repositories.blood_units.get_by_id(id).await {
        Ok(Some(unit)) => Ok(unit),
        Ok(None) => Err(unit_error(
            HttpResponse::NotFound(),
            "Blood unit not found.",
            "BLOOD_UNIT_NOT_FOUND",
        )),
        Err(error) => Err(unit_unavailable("load", error)),
    }
}

/// The patient's recorded blood group: 404 when the patient is unknown.
async fn patient_blood_type(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> Result<crate::BloodType, HttpResponse> {
    let entity = data
        .repositories
        .patients
        .get_by_id(patient_id)
        .await
        .map_err(|_| {
            unit_error(
                HttpResponse::NotFound(),
                "Patient not found.",
                "PATIENT_NOT_FOUND",
            )
        })?;
    Ok(patient_entity_to_profile(&entity, &data.encryption_keyring)
        .map(|profile| profile.emergency_info.blood_type)
        .unwrap_or(crate::BloodType::Unknown))
}

/// Apply a transition, answering 409 when the unit's state refused it.
async fn transition(
    data: &web::Data<AppState>,
    unit_id: &str,
    change: UnitTransition,
    audit: AccessLogEntity,
) -> HttpResponse {
    match data.repositories.transition_blood_unit(unit_id, change, Utc::now(), audit).await {
        Ok(Some(unit)) => HttpResponse::Ok().json(serde_json::json!({ "success": true, "unit": unit_view(&unit, Utc::now().date_naive()) })),
        Ok(None) => unit_error(HttpResponse::Conflict(), "This unit is not in a state that allows that (taken, issued, expired, or reserved for someone else).", "BLOOD_UNIT_STATE"),
        Err(error) => unit_unavailable("transition", error),
    }
}

/// Reserve a unit for a patient after crossmatch (blood-bank staff).
/// 409 `ABO_INCOMPATIBLE` when the unit does not suit the patient's group.
#[post("/api/blood-bank/units/{unit_id}/reserve")]
pub async fn reserve_blood_unit(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<ReserveUnitBody>,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if let Err(response) = ensure_blood_bank_role(&caller) {
        return response;
    }
    let Some(crossmatch) = clean_field(&body.crossmatch_reference, 1, MAX_CROSSMATCH_CHARS) else {
        return unit_error(
            HttpResponse::BadRequest(),
            "Give the crossmatch reference (up to 64 characters).",
            "CROSSMATCH_REQUIRED",
        );
    };
    let unit = match load_unit(&data, &path.into_inner()).await {
        Ok(unit) => unit,
        Err(response) => return response,
    };
    let patient_id = body.patient_id.trim().to_string();
    let group = match patient_blood_type(&data, &patient_id).await {
        Ok(group) => group,
        Err(response) => return response,
    };
    if !compatible(&unit, &group) {
        return unit_error(HttpResponse::Conflict(), "This unit is not compatible with the patient's recorded blood group. If the group is Unknown, only O Rh-negative red cells or AB plasma may be reserved: type and cross-match first.", "ABO_INCOMPATIBLE");
    }
    let audit = unit_audit(&caller, &unit.id, Some(&patient_id), "blood_unit_reserved");
    transition(
        &data,
        &unit.id,
        UnitTransition::Reserve {
            patient_id,
            crossmatch_reference: crossmatch,
        },
        audit,
    )
    .await
}

/// Return a reserved unit to stock (blood-bank staff).
#[post("/api/blood-bank/units/{unit_id}/release")]
pub async fn release_blood_unit(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if let Err(response) = ensure_blood_bank_role(&caller) {
        return response;
    }
    let unit = match load_unit(&data, &path.into_inner()).await {
        Ok(unit) => unit,
        Err(response) => return response,
    };
    let audit = unit_audit(
        &caller,
        &unit.id,
        unit.reserved_for_patient_id.as_deref(),
        "blood_unit_released",
    );
    transition(&data, &unit.id, UnitTransition::Release, audit).await
}

/// Issue a reserved unit against its patient's transfusion record
/// (blood-bank staff). 404 for an unknown transfusion; 409 when the
/// transfusion is another patient's or the unit's state refuses it.
#[post("/api/blood-bank/units/{unit_id}/issue")]
pub async fn issue_blood_unit(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<IssueUnitBody>,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if let Err(response) = ensure_blood_bank_role(&caller) {
        return response;
    }
    let unit = match load_unit(&data, &path.into_inner()).await {
        Ok(unit) => unit,
        Err(response) => return response,
    };
    let transfusion_id = body.transfusion_id.trim().to_string();
    let transfusion_patient = match data
        .repositories
        .transfusion_event_records
        .get_by_id(&transfusion_id)
        .await
    {
        Ok(Some(record)) => record.owner_id,
        Ok(None) => {
            return unit_error(
                HttpResponse::NotFound(),
                "Transfusion record not found.",
                "TRANSFUSION_NOT_FOUND",
            )
        }
        Err(error) => return unit_unavailable("load transfusion", error),
    };
    if unit.reserved_for_patient_id.as_deref() != Some(transfusion_patient.as_str()) {
        return unit_error(
            HttpResponse::Conflict(),
            "This unit is reserved for a different patient than the transfusion record.",
            "PATIENT_MISMATCH",
        );
    }
    let audit = unit_audit(
        &caller,
        &unit.id,
        Some(&transfusion_patient),
        "blood_unit_issued",
    );
    transition(
        &data,
        &unit.id,
        UnitTransition::Issue {
            patient_id: transfusion_patient,
            transfusion_id,
        },
        audit,
    )
    .await
}

/// Discard an unissued unit with a reason (blood-bank staff).
#[post("/api/blood-bank/units/{unit_id}/discard")]
pub async fn discard_blood_unit(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<DiscardUnitBody>,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if let Err(response) = ensure_blood_bank_role(&caller) {
        return response;
    }
    let Some(reason) = clean_field(
        &body.reason,
        MIN_DISCARD_REASON_CHARS,
        MAX_DISCARD_REASON_CHARS,
    ) else {
        return unit_error(
            HttpResponse::BadRequest(),
            "Give a reason of 5 to 500 characters.",
            "DISCARD_REASON_REQUIRED",
        );
    };
    let unit = match load_unit(&data, &path.into_inner()).await {
        Ok(unit) => unit,
        Err(response) => return response,
    };
    let audit = unit_audit(&caller, &unit.id, None, "blood_unit_discarded");
    transition(&data, &unit.id, UnitTransition::Discard { reason }, audit).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};

    const TECH: &str = "lab_tech";
    const NURSE: &str = "nurse_bb";
    const PATIENT_A_NEG: &str = "PAT-ANEG";
    const PATIENT_UNKNOWN: &str = "PAT-UNK";

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        crate::test_fixtures::register(&state, TECH, crate::Role::LabTechnician);
        crate::test_fixtures::register(&state, NURSE, crate::Role::Nurse);
        for (id, group) in [
            (PATIENT_A_NEG, crate::BloodType::ANegative),
            (PATIENT_UNKNOWN, crate::BloodType::Unknown),
        ] {
            let mut profile = crate::test_fixtures::patient_profile(id, "Synthetic Recipient");
            profile.emergency_info.blood_type = group;
            let entity = crate::patient_profile_to_entity(&profile, &state.encryption_keyring);
            state.repositories.patients.create(entity).await.unwrap();
        }
        let now = Utc::now();
        state
            .repositories
            .transfusion_event_records
            .create(JsonRecordEntity {
                id: "TX-A".into(),
                owner_id: PATIENT_A_NEG.into(),
                data: serde_json::json!({}),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        web::Data::new(state)
    }

    async fn call(
        state: &web::Data<AppState>,
        request: test::TestRequest,
        wallet: &str,
    ) -> (u16, serde_json::Value) {
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(list_blood_units)
                .service(receive_blood_unit)
                .service(reserve_blood_unit)
                .service(release_blood_unit)
                .service(issue_blood_unit)
                .service(discard_blood_unit),
        )
        .await;
        let response = test::call_service(
            &app,
            request.insert_header(("x-user-id", wallet)).to_request(),
        )
        .await;
        let status = response.status().as_u16();
        let body = test::read_body(response).await;
        (
            status,
            serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null),
        )
    }

    /// Receive a unit of `abo`/`rh` red cells expiring in `days`; return its id.
    async fn receive(
        state: &web::Data<AppState>,
        number: &str,
        abo: &str,
        rh: &str,
        days: i64,
    ) -> String {
        let today = Utc::now().date_naive();
        let body = serde_json::json!({
            "unit_number": number, "product_type": "PackedRBC", "abo": abo, "rh": rh,
            "collected_on": today - chrono::Duration::days(20),
            "expires_on": today + chrono::Duration::days(days),
            "location": "Blood fridge 2",
        });
        let (status, response) = call(
            state,
            test::TestRequest::post()
                .uri("/api/blood-bank/units")
                .set_json(body),
            TECH,
        )
        .await;
        assert_eq!(status, 201, "{response}");
        response["unit"]["id"].as_str().unwrap().to_string()
    }

    fn reserve(id: &str, patient: &str) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!("/api/blood-bank/units/{id}/reserve"))
            .set_json(serde_json::json!({ "patient_id": patient, "crossmatch_reference": "XM-2026-0001" }))
    }

    #[actix_web::test]
    async fn a_unit_is_received_reserved_and_issued_to_its_patients_transfusion() {
        let state = state().await;
        let id = receive(&state, "za1000001", "O", "negative", 10).await;
        assert_eq!(call(&state, reserve(&id, PATIENT_A_NEG), TECH).await.0, 200);
        let issue = test::TestRequest::post()
            .uri(&format!("/api/blood-bank/units/{id}/issue"))
            .set_json(serde_json::json!({ "transfusion_id": "TX-A" }));
        let (status, body) = call(&state, issue, TECH).await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["unit"]["status"], "issued");
        assert_eq!(
            body["unit"]["unit_number"], "ZA1000001",
            "unit numbers are normalised to upper case"
        );
        assert_eq!(body["unit"]["transfusion_id"], "TX-A");
    }

    #[actix_web::test]
    async fn an_incompatible_unit_is_refused_and_an_unknown_group_gets_only_o_negative() {
        let state = state().await;
        let a_pos = receive(&state, "ZA1000002", "A", "positive", 10).await;
        let (status, body) = call(&state, reserve(&a_pos, PATIENT_A_NEG), TECH).await;
        assert_eq!(
            (status, body["error"]["code"].as_str()),
            (409, Some("ABO_INCOMPATIBLE"))
        );
        let o_pos = receive(&state, "ZA1000003", "O", "positive", 10).await;
        assert_eq!(
            call(&state, reserve(&o_pos, PATIENT_UNKNOWN), TECH).await.0,
            409
        );
        let o_neg = receive(&state, "ZA1000004", "O", "negative", 10).await;
        assert_eq!(
            call(&state, reserve(&o_neg, PATIENT_UNKNOWN), TECH).await.0,
            200
        );
    }

    #[actix_web::test]
    async fn a_unit_reserved_for_one_patient_cannot_go_to_anothers_transfusion() {
        let state = state().await;
        let now = Utc::now();
        state
            .repositories
            .transfusion_event_records
            .create(JsonRecordEntity {
                id: "TX-U".into(),
                owner_id: PATIENT_UNKNOWN.into(),
                data: serde_json::json!({}),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        let id = receive(&state, "ZA1000005", "O", "negative", 10).await;
        call(&state, reserve(&id, PATIENT_A_NEG), TECH).await;
        let issue = test::TestRequest::post()
            .uri(&format!("/api/blood-bank/units/{id}/issue"))
            .set_json(serde_json::json!({ "transfusion_id": "TX-U" }));
        let (status, body) = call(&state, issue, TECH).await;
        assert_eq!(
            (status, body["error"]["code"].as_str()),
            (409, Some("PATIENT_MISMATCH"))
        );
    }

    #[actix_web::test]
    async fn only_blood_bank_staff_change_stock_and_duplicates_are_refused() {
        let state = state().await;
        let id = receive(&state, "ZA1000006", "O", "negative", 10).await;
        assert_eq!(
            call(&state, reserve(&id, PATIENT_A_NEG), NURSE).await.0,
            403
        );
        let today = Utc::now().date_naive();
        let again = serde_json::json!({
            "unit_number": "ZA1000006", "product_type": "PackedRBC", "abo": "O", "rh": "negative",
            "collected_on": today, "expires_on": today, "location": "Fridge",
        });
        assert_eq!(
            call(
                &state,
                test::TestRequest::post()
                    .uri("/api/blood-bank/units")
                    .set_json(again),
                TECH
            )
            .await
            .0,
            409
        );
        // Nurses can read stock.
        let (status, body) = call(
            &state,
            test::TestRequest::get().uri("/api/blood-bank/units"),
            NURSE,
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(body["summary"]["thresholds_are_defaults"], true);
    }

    #[actix_web::test]
    async fn bad_dates_and_numbers_are_rejected_at_the_boundary() {
        let state = state().await;
        let today = Utc::now().date_naive();
        let backwards = serde_json::json!({
            "unit_number": "ZA1000007", "product_type": "PackedRBC", "abo": "O", "rh": "negative",
            "collected_on": today, "expires_on": today - chrono::Duration::days(1), "location": "Fridge",
        });
        assert_eq!(
            call(
                &state,
                test::TestRequest::post()
                    .uri("/api/blood-bank/units")
                    .set_json(backwards),
                TECH
            )
            .await
            .0,
            400
        );
        let bad_number = serde_json::json!({
            "unit_number": "ZA 1'; DROP", "product_type": "PackedRBC", "abo": "O", "rh": "negative",
            "collected_on": today, "expires_on": today, "location": "Fridge",
        });
        assert_eq!(
            call(
                &state,
                test::TestRequest::post()
                    .uri("/api/blood-bank/units")
                    .set_json(bad_number),
                TECH
            )
            .await
            .0,
            400
        );
        let bad_group = serde_json::json!({
            "unit_number": "ZA1000008", "product_type": "PackedRBC", "abo": "Q", "rh": "negative",
            "collected_on": today, "expires_on": today, "location": "Fridge",
        });
        assert_eq!(
            call(
                &state,
                test::TestRequest::post()
                    .uri("/api/blood-bank/units")
                    .set_json(bad_group),
                TECH
            )
            .await
            .0,
            400
        );
    }
}
