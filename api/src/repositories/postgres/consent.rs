//! PostgreSQL repositories for consent records.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

/// PostgreSQL-backed consent record repository
#[derive(Debug, Clone)]
pub struct PgConsentRecordRepository {
    pool: PgPool,
}

impl PgConsentRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ConsentRecordRepository for PgConsentRecordRepository {
    /// The patient's live consent of one type, if any.
    ///
    /// "Active" means granted, not revoked, and not past its expiry — the same
    /// three conditions the in-memory backend applies. Without this override the
    /// trait default returned `get_active_by_type not implemented`, so a consent
    /// check that worked in demo mode failed on PostgreSQL. A consent lookup
    /// that errors is a consent that cannot be honoured.
    async fn get_active_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Option<ConsentRecordEntity>> {
        let record = sqlx::query_as::<_, ConsentRecordEntity>(
            "SELECT * FROM consent_records \
             WHERE patient_id = $1 AND consent_type = $2 \
               AND COALESCE(revoked, false) = false \
               AND (expiration_datetime IS NULL OR expiration_datetime > NOW()) \
             ORDER BY consent_datetime DESC LIMIT 1",
        )
        .bind(patient_id)
        .bind(consent_type)
        .fetch_optional(&self.pool)
        .await?;
        Ok(record)
    }

    /// Every live consent the patient currently holds.
    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let records = sqlx::query_as::<_, ConsentRecordEntity>(
            "SELECT * FROM consent_records \
             WHERE patient_id = $1 \
               AND COALESCE(revoked, false) = false \
               AND (expiration_datetime IS NULL OR expiration_datetime > NOW()) \
             ORDER BY consent_datetime DESC",
        )
        .bind(patient_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(records)
    }

    async fn create(&self, record: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO consent_records (
                id, patient_id, consent_type, consent_given, consent_datetime,
                expiration_datetime, scope_description, data_types_covered, purpose,
                recipient_organization, collection_method, witness_name, witness_signature,
                collector_id, collector_name, revoked, revoked_datetime, revocation_reason,
                revoked_by, document_url, document_ipfs_hash, regulatory_requirement, version,
                popia_section_11_basis, special_information_basis, child_information_basis,
                consent_required, consent_status, consent_given_by, consent_giver_capacity,
                guardian_authority_evidence_id, privacy_notice_version, emergency_basis,
                emergency_justification, child_maturity_assessment, child_maturity_assessed_by
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.consent_type)
                .push_bind(r.consent_given)
                .push_bind(r.consent_datetime)
                .push_bind(r.expiration_datetime)
                .push_bind(&r.scope_description)
                .push_bind(&r.data_types_covered)
                .push_bind(&r.purpose)
                .push_bind(&r.recipient_organization)
                .push_bind(&r.collection_method)
                .push_bind(&r.witness_name)
                .push_bind(&r.witness_signature)
                .push_bind(&r.collector_id)
                .push_bind(&r.collector_name)
                .push_bind(r.revoked)
                .push_bind(r.revoked_datetime)
                .push_bind(&r.revocation_reason)
                .push_bind(&r.revoked_by)
                .push_bind(&r.document_url)
                .push_bind(&r.document_ipfs_hash)
                .push_bind(&r.regulatory_requirement)
                .push_bind(&r.version)
                .push_bind(&r.popia_section_11_basis)
                .push_bind(&r.special_information_basis)
                .push_bind(&r.child_information_basis)
                .push_bind(r.consent_required)
                .push_bind(&r.consent_status)
                .push_bind(&r.consent_given_by)
                .push_bind(&r.consent_giver_capacity)
                .push_bind(&r.guardian_authority_evidence_id)
                .push_bind(&r.privacy_notice_version)
                .push_bind(&r.emergency_basis)
                .push_bind(&r.emergency_justification)
                .push_bind(&r.child_maturity_assessment)
                .push_bind(&r.child_maturity_assessed_by);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsentRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consent_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consent_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY consent_datetime DESC");

        let items = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consent_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND consent_given = true AND (revoked IS NULL OR revoked = false) ORDER BY consent_datetime DESC");

        let items = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consent_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND consent_type = ");
        qb.push_bind(consent_type);
        qb.push(" ORDER BY consent_datetime DESC");

        let items = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(&self, record: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE consent_records SET ");
        qb.push("scope_description = ")
            .push_bind(&record.scope_description);
        qb.push(", data_types_covered = ")
            .push_bind(&record.data_types_covered);
        qb.push(", expiration_datetime = ")
            .push_bind(record.expiration_datetime);
        qb.push(", consent_given = ")
            .push_bind(record.consent_given);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn revoke(
        &self,
        id: &str,
        revoked_by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<ConsentRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE consent_records SET ");
        // `consent_status` is authoritative and `consent_given` is its legacy
        // projection, so both move together — leaving the status at 'granted'
        // on a revoked record would misreport the lawful basis for every read
        // that (correctly) trusts the newer field.
        qb.push("consent_given = false, consent_status = 'withdrawn'");
        qb.push(", revoked = true, revoked_datetime = NOW()");
        qb.push(", revoked_by = ").push_bind(revoked_by);
        qb.push(", revocation_reason = ").push_bind(reason);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" AND (revoked IS NULL OR revoked = false)");
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_optional(&self.pool)
            .await?;

        result.ok_or_else(|| {
            RepositoryError::Validation(format!("Consent {id} is not active or does not exist"))
        })
    }

    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM consent_records 
             WHERE consent_given = true 
             AND (revoked IS NULL OR revoked = false) 
             AND expiration_datetime IS NOT NULL 
             AND expiration_datetime <= NOW() + INTERVAL '",
        );
        qb.push(days.to_string());
        qb.push(" days' ORDER BY expiration_datetime ASC");

        let items = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn check_consent(
        &self,
        patient_id: &str,
        consent_type: &str,
        purpose: &str,
    ) -> RepositoryResult<bool> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) > 0 AS has_consent FROM consent_records WHERE patient_id = ",
        );
        qb.push_bind(patient_id);
        qb.push(" AND consent_type = ");
        qb.push_bind(consent_type);
        qb.push(" AND purpose = ");
        qb.push_bind(purpose);
        qb.push(" AND consent_given = true AND (revoked IS NULL OR revoked = false)");
        qb.push(" AND (expiration_datetime IS NULL OR expiration_datetime > NOW())");

        #[derive(sqlx::FromRow)]
        struct ConsentCheck {
            has_consent: bool,
        }

        let result = qb
            .build_query_as::<ConsentCheck>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result.has_consent)
    }
}
