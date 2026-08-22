//! PostgreSQL implementation of the patient access repository.
//!
//! See `repositories::memory::patient_access` for the design rationale. Every
//! state transition here is a conditional UPDATE whose `WHERE` clause carries
//! the precondition, so the check and the write are one statement: a replayed
//! approval matches no row and returns `Ok(None)` rather than minting a second
//! grant.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Transaction};

use crate::repositories::traits::{
    AccessGrantEntity, AccessRequestEntity, PatientAccessRepository, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgPatientAccessRepository {
    pool: PgPool,
}

impl PgPatientAccessRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const REQUEST_COLUMNS: &str = "id, patient_id, provider_id, provider_name, provider_role, \
    organization, requested_at, reason, status";

const GRANT_COLUMNS: &str = "id, patient_id, provider_id, provider_name, provider_role, \
    organization, access_type, granted_at, expires_at, status, last_accessed, access_count, \
    source_request_id";

async fn insert_audit_event(
    tx: &mut Transaction<'_, Postgres>,
    event: &crate::audit_outbox::AuditOutboxEvent,
) -> RepositoryResult<()> {
    sqlx::query(
        "INSERT INTO audit_outbox_events (
            id, event_type, aggregate_type, aggregate_id, payload_hash,
            payload, occurred_at, delivered_at, delivery_attempts, last_error
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(&event.id)
    .bind(&event.event_type)
    .bind(&event.aggregate_type)
    .bind(&event.aggregate_id)
    .bind(&event.payload_hash)
    .bind(&event.payload)
    .bind(event.occurred_at)
    .bind(event.delivered_at)
    .bind(i32::try_from(event.delivery_attempts).map_err(|_| {
        crate::repositories::traits::RepositoryError::Validation(
            "delivery attempt count exceeds PostgreSQL INTEGER".into(),
        )
    })?)
    .bind(&event.last_error)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[async_trait]
impl PatientAccessRepository for PgPatientAccessRepository {
    async fn create_request(
        &self,
        request: AccessRequestEntity,
    ) -> RepositoryResult<AccessRequestEntity> {
        let result = sqlx::query_as::<Postgres, AccessRequestEntity>(&format!(
            "INSERT INTO patient_access_requests
                (id, patient_id, provider_id, provider_name, provider_role, organization,
                 requested_at, reason, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING {REQUEST_COLUMNS}"
        ))
        .bind(&request.id)
        .bind(&request.patient_id)
        .bind(&request.provider_id)
        .bind(&request.provider_name)
        .bind(&request.provider_role)
        .bind(&request.organization)
        .bind(request.requested_at)
        .bind(&request.reason)
        .bind(&request.status)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn create_request_with_audit(
        &self,
        request: AccessRequestEntity,
        event: crate::audit_outbox::AuditOutboxEvent,
    ) -> RepositoryResult<AccessRequestEntity> {
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query_as::<Postgres, AccessRequestEntity>(&format!(
            "INSERT INTO patient_access_requests
                (id, patient_id, provider_id, provider_name, provider_role, organization,
                 requested_at, reason, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING {REQUEST_COLUMNS}"
        ))
        .bind(&request.id)
        .bind(&request.patient_id)
        .bind(&request.provider_id)
        .bind(&request.provider_name)
        .bind(&request.provider_role)
        .bind(&request.organization)
        .bind(request.requested_at)
        .bind(&request.reason)
        .bind(&request.status)
        .fetch_one(&mut *tx)
        .await?;

        insert_audit_event(&mut tx, &event).await?;
        tx.commit().await?;
        Ok(result)
    }

    async fn get_request(&self, id: &str) -> RepositoryResult<Option<AccessRequestEntity>> {
        let result = sqlx::query_as::<Postgres, AccessRequestEntity>(&format!(
            "SELECT {REQUEST_COLUMNS} FROM patient_access_requests WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn list_requests_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AccessRequestEntity>> {
        let result = sqlx::query_as::<Postgres, AccessRequestEntity>(&format!(
            "SELECT {REQUEST_COLUMNS} FROM patient_access_requests
             WHERE patient_id = $1
             ORDER BY requested_at DESC"
        ))
        .bind(patient_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn approve_request(
        &self,
        request_id: &str,
        grant: AccessGrantEntity,
    ) -> RepositoryResult<Option<(AccessRequestEntity, AccessGrantEntity)>> {
        let mut tx = self.pool.begin().await?;

        let decided = sqlx::query_as::<Postgres, AccessRequestEntity>(&format!(
            "UPDATE patient_access_requests
             SET status = 'approved'
             WHERE id = $1 AND status = 'pending'
             RETURNING {REQUEST_COLUMNS}"
        ))
        .bind(request_id)
        .fetch_optional(&mut *tx)
        .await?;

        // Not pending: already approved, already denied, or gone. Nothing is
        // written — dropping `tx` rolls back.
        let Some(decided) = decided else {
            return Ok(None);
        };

        let stored = sqlx::query_as::<Postgres, AccessGrantEntity>(&format!(
            "INSERT INTO patient_access_grants
                (id, patient_id, provider_id, provider_name, provider_role, organization,
                 access_type, granted_at, expires_at, status, last_accessed, access_count,
                 source_request_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING {GRANT_COLUMNS}"
        ))
        .bind(&grant.id)
        .bind(&grant.patient_id)
        .bind(&grant.provider_id)
        .bind(&grant.provider_name)
        .bind(&grant.provider_role)
        .bind(&grant.organization)
        .bind(&grant.access_type)
        .bind(grant.granted_at)
        .bind(grant.expires_at)
        .bind(&grant.status)
        .bind(grant.last_accessed)
        .bind(grant.access_count)
        .bind(&grant.source_request_id)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(Some((decided, stored)))
    }

    async fn approve_request_with_audit(
        &self,
        request_id: &str,
        grant: AccessGrantEntity,
        event: crate::audit_outbox::AuditOutboxEvent,
    ) -> RepositoryResult<Option<(AccessRequestEntity, AccessGrantEntity)>> {
        let mut tx = self.pool.begin().await?;
        let decided = sqlx::query_as::<Postgres, AccessRequestEntity>(&format!(
            "UPDATE patient_access_requests SET status = 'approved'
             WHERE id = $1 AND status = 'pending' RETURNING {REQUEST_COLUMNS}"
        ))
        .bind(request_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(decided) = decided else {
            return Ok(None);
        };
        let stored = sqlx::query_as::<Postgres, AccessGrantEntity>(&format!(
            "INSERT INTO patient_access_grants
                (id, patient_id, provider_id, provider_name, provider_role, organization,
                 access_type, granted_at, expires_at, status, last_accessed, access_count,
                 source_request_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING {GRANT_COLUMNS}"
        ))
        .bind(&grant.id)
        .bind(&grant.patient_id)
        .bind(&grant.provider_id)
        .bind(&grant.provider_name)
        .bind(&grant.provider_role)
        .bind(&grant.organization)
        .bind(&grant.access_type)
        .bind(grant.granted_at)
        .bind(grant.expires_at)
        .bind(&grant.status)
        .bind(grant.last_accessed)
        .bind(grant.access_count)
        .bind(&grant.source_request_id)
        .fetch_one(&mut *tx)
        .await?;
        insert_audit_event(&mut tx, &event).await?;
        tx.commit().await?;
        Ok(Some((decided, stored)))
    }

    async fn deny_request(
        &self,
        request_id: &str,
    ) -> RepositoryResult<Option<AccessRequestEntity>> {
        let result = sqlx::query_as::<Postgres, AccessRequestEntity>(&format!(
            "UPDATE patient_access_requests
             SET status = 'denied'
             WHERE id = $1 AND status = 'pending'
             RETURNING {REQUEST_COLUMNS}"
        ))
        .bind(request_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn deny_request_with_audit(
        &self,
        request_id: &str,
        event: crate::audit_outbox::AuditOutboxEvent,
    ) -> RepositoryResult<Option<AccessRequestEntity>> {
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query_as::<Postgres, AccessRequestEntity>(&format!(
            "UPDATE patient_access_requests SET status = 'denied'
             WHERE id = $1 AND status = 'pending' RETURNING {REQUEST_COLUMNS}"
        ))
        .bind(request_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(request) = result else {
            return Ok(None);
        };
        insert_audit_event(&mut tx, &event).await?;
        tx.commit().await?;
        Ok(Some(request))
    }

    async fn get_grant(&self, id: &str) -> RepositoryResult<Option<AccessGrantEntity>> {
        let result = sqlx::query_as::<Postgres, AccessGrantEntity>(&format!(
            "SELECT {GRANT_COLUMNS} FROM patient_access_grants WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn list_grants_by_patient(
        &self,
        patient_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Vec<AccessGrantEntity>> {
        let mut tx = self.pool.begin().await?;

        // Lazy expiry, persisted: a grant whose window has closed must not read
        // back as `active` to anyone, not just to this caller.
        sqlx::query(
            "UPDATE patient_access_grants
             SET status = 'expired'
             WHERE patient_id = $1
               AND status = 'active'
               AND expires_at IS NOT NULL
               AND expires_at <= $2",
        )
        .bind(patient_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        let result = sqlx::query_as::<Postgres, AccessGrantEntity>(&format!(
            "SELECT {GRANT_COLUMNS} FROM patient_access_grants
             WHERE patient_id = $1
             ORDER BY granted_at DESC"
        ))
        .bind(patient_id)
        .fetch_all(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(result)
    }

    async fn revoke_grant(
        &self,
        grant_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<AccessGrantEntity>> {
        let result = sqlx::query_as::<Postgres, AccessGrantEntity>(&format!(
            "UPDATE patient_access_grants
             SET status = 'revoked'
             WHERE id = $1
               AND status = 'active'
               AND (expires_at IS NULL OR expires_at > $2)
             RETURNING {GRANT_COLUMNS}"
        ))
        .bind(grant_id)
        .bind(now)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }
}
