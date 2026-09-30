//! Shared test fixtures: a registered user and a patient on record.
//!
//! Handler tests keep needing the same two things -- somebody signed in with a
//! role, and a patient the record can be about -- and each module had grown
//! its own copy of the 30-field profile literal. New tests use these.

use crate::AppState;

/// The header a signed-in caller sends: a real access token whose `sub` is
/// `user_id`, signed with the server's key. Handlers read the caller from the
/// verified token only, so a test that wants to be `user_id` has to carry one.
///
/// In-memory tests may use any string as an id; PostgreSQL tests use a real
/// `users.id` UUID.
pub fn as_user(user_id: impl AsRef<str>) -> (&'static str, String) {
    let token = crate::security::jwt::issue_access_token(user_id.as_ref(), "Test", false, None)
        .expect("test access token");
    ("Authorization", format!("Bearer {token}"))
}

/// A real `users` row for a PostgreSQL test, returned as the text id every
/// actor column, session and token carries. Session, MFA and grant tables
/// reference `users(id)`, so a test that writes to them needs a user first.
pub async fn insert_pg_user(pool: &sqlx::PgPool, role: &str) -> String {
    let id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, role, name, status, is_active)
         VALUES ($1, $2, 'Test User', 'active', true)",
    )
    .bind(id)
    .bind(role)
    .execute(pool)
    .await
    .expect("insert test user");
    id.to_string()
}

/// A registered, active user with `role`, keyed by `id`.
pub fn staff(id: &str, role: crate::Role) -> crate::User {
    crate::User {
        id: id.to_string(),
        username: Some(id.to_string()),
        name: format!("Test {id}"),
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
    }
}

/// Put a user in the session cache the handlers resolve callers from.
pub fn register(state: &AppState, id: &str, role: crate::Role) {
    state
        .users
        .write()
        .unwrap()
        .insert(id.to_string(), staff(id, role));
}

/// A minimal, complete patient profile.
pub fn patient_profile(id: &str, name: &str) -> crate::PatientProfile {
    let now = chrono::Utc::now();
    crate::PatientProfile {
        patient_id: id.to_string(),
        full_name: name.to_string(),
        date_of_birth: "1980-01-01".to_string(),
        time_of_birth: None,
        national_id: format!("NID-{id}"),
        gender: None,
        phone: "+27000000000".to_string(),
        emergency_info: crate::EmergencyInfo {
            patient_id: id.to_string(),
            blood_type: crate::BloodType::OPositive,
            allergies: Vec::new(),
            current_medications: Vec::new(),
            chronic_conditions: Vec::new(),
            emergency_contacts: Vec::new(),
            organ_donor: false,
            dnr_status: false,
            dnr_verified_by: None,
            dnr_verified_at: None,
            dnr_document_ref: None,
            languages: vec!["en".to_string()],
            last_updated: now,
        },
        address: None,
        insurance: None,
        primary_doctor: None,
        community_health_worker: None,
        preferences: crate::PatientPreferences::default(),
        advanced_directives: Vec::new(),
        family_notifications: None,
        created_at: now,
        last_updated: now,
    }
}

/// Store a patient so records can refer to them.
pub async fn seed_patient(state: &AppState, id: &str) {
    state
        .repositories
        .patients
        .create(crate::patient_profile_to_entity(
            &patient_profile(id, "Test Patient"),
            &state.encryption_keyring,
        ))
        .await
        .expect("seed patient");
}

use actix_web::{web, App, HttpResponse, HttpServer};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Store behind the fake IPFS node: content id -> bytes.
type FakeIpfsBlobs = Arc<Mutex<HashMap<String, Vec<u8>>>>;

/// The file bytes inside a single-part multipart body.
fn multipart_file(body: &[u8]) -> Vec<u8> {
    let start = body
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
        .unwrap_or(0);
    let end = body
        .windows(4)
        .rposition(|w| w == b"\r\n--")
        .unwrap_or(body.len());
    body[start..end.max(start)].to_vec()
}

/// A minimal Kubo RPC stand-in (`add` stores, `cat` returns) on a free local
/// port. Returns its base URL for `IpfsClient::new`. Lets encrypted-document
/// tests run the real encrypt, upload, download and decrypt path.
pub async fn fake_ipfs() -> String {
    let blobs: FakeIpfsBlobs = Arc::default();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let server = HttpServer::new(move || {
        let (add_blobs, cat_blobs) = (blobs.clone(), blobs.clone());
        App::new()
            .route(
                "/api/v0/add",
                web::post().to(move |body: web::Bytes| {
                    let blobs = add_blobs.clone();
                    async move {
                        let file = multipart_file(&body);
                        let cid = format!("b{}", hex::encode(medichain_crypto::sha256(&file)));
                        blobs.lock().unwrap().insert(cid.clone(), file);
                        HttpResponse::Ok().json(serde_json::json!({ "Hash": cid }))
                    }
                }),
            )
            .route(
                "/api/v0/cat",
                web::post().to(move |q: web::Query<HashMap<String, String>>| {
                    let blobs = cat_blobs.clone();
                    async move {
                        match blobs
                            .lock()
                            .unwrap()
                            .get(q.get("arg").map(String::as_str).unwrap_or_default())
                        {
                            Some(bytes) => HttpResponse::Ok().body(bytes.clone()),
                            None => HttpResponse::InternalServerError().body("not found"),
                        }
                    }
                }),
            )
    })
    .listen(listener)
    .unwrap()
    .run();
    actix_web::rt::spawn(server);
    address
}
