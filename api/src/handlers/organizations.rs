//! The federation boundary an administrator can actually see.
//!
//! Organisations and facilities were writable only by migration and readable
//! only by foreign key. Nothing served them, so every screen that needs an
//! organisation id -- device enrolment is the one that forced this -- had to
//! ask an administrator to type an identifier they have no way to look up.

use super::*;

#[derive(Debug, Serialize)]
pub struct FacilitySummary {
    pub id: String,
    pub organization_id: String,
    pub name: String,
    pub facility_type: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct OrganizationSummary {
    pub id: String,
    pub name: String,
    pub organization_type: String,
    pub status: String,
    pub facilities: Vec<FacilitySummary>,
}

/// Every organisation in this deployment, with its facilities.
///
/// Administrators only: this is the federation boundary, not clinical data, but
/// it names every institution the deployment federates with.
#[get("/api/organizations")]
pub async fn list_organizations(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    // The memory backend has no `organizations` table. It is not an empty
    // deployment -- `federation_identity` assigns every legacy professional to
    // `legacy-organization` / `legacy-facility`, so those are the real answer
    // there, and `backend: "memory"` says where the answer came from rather
    // than passing a constant off as a database read.
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "backend": "memory",
            "organizations": [legacy_boundary()],
        }));
    };
    match load_organizations(pool).await {
        Ok(organizations) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "backend": "postgres",
            "organizations": organizations,
        })),
        Err(error) => {
            log::error!("organisation listing failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Organisation directory is unavailable".into(),
                code: "ORGANIZATION_DIRECTORY_UNAVAILABLE".into(),
            })
        }
    }
}

fn legacy_boundary() -> OrganizationSummary {
    OrganizationSummary {
        id: "legacy-organization".into(),
        name: "MediChain legacy deployment".into(),
        organization_type: "healthcare_provider".into(),
        status: "active".into(),
        facilities: vec![FacilitySummary {
            id: "legacy-facility".into(),
            organization_id: "legacy-organization".into(),
            name: "MediChain legacy facility".into(),
            facility_type: "healthcare".into(),
            status: "active".into(),
        }],
    }
}

async fn load_organizations(pool: &sqlx::PgPool) -> Result<Vec<OrganizationSummary>, sqlx::Error> {
    use sqlx::Row;
    let facility_rows = sqlx::query(
        "SELECT id, organization_id, name, facility_type, status FROM facilities ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    let mut facilities: std::collections::HashMap<String, Vec<FacilitySummary>> =
        std::collections::HashMap::new();
    for row in facility_rows {
        let organization_id: String = row.try_get("organization_id")?;
        facilities
            .entry(organization_id.clone())
            .or_default()
            .push(FacilitySummary {
                id: row.try_get("id")?,
                organization_id,
                name: row.try_get("name")?,
                facility_type: row.try_get("facility_type")?,
                status: row.try_get("status")?,
            });
    }
    let rows =
        sqlx::query("SELECT id, name, organization_type, status FROM organizations ORDER BY name")
            .fetch_all(pool)
            .await?;
    let mut organizations = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.try_get("id")?;
        organizations.push(OrganizationSummary {
            facilities: facilities.remove(&id).unwrap_or_default(),
            id,
            name: row.try_get("name")?,
            organization_type: row.try_get("organization_type")?,
            status: row.try_get("status")?,
        });
    }
    Ok(organizations)
}
