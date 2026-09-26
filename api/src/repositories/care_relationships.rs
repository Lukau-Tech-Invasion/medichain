//! Care relationships and break-glass grants (WP9): the two records, besides
//! the patient's own grants, that let a clinician open a chart. The tables'
//! CHECKs (`20260926000009_care_relationships.sql`) keep a relationship naming
//! someone and a break-glass grant time-limited.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;

use super::traits::{RepositoryError, RepositoryResult};

/// Longest a break-glass grant may last, in hours (the table's CHECK agrees).
pub const MAX_BREAK_GLASS_HOURS: i64 = 12;

/// One care relationship row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct CareRelationshipEntity {
    pub id: String,
    pub patient_id: String,
    pub clinician_id: Option<String>,
    pub facility_id: Option<String>,
    /// `encounter`, `admission`, `referral` or `patient_grant`.
    pub source: String,
    pub source_id: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl CareRelationshipEntity {
    /// Whether the relationship covers `now`.
    pub fn is_active(&self, now: DateTime<Utc>) -> bool {
        self.starts_at <= now && self.ends_at.is_none_or(|end| now < end)
    }
}

/// One break-glass grant row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct BreakGlassGrantEntity {
    pub id: String,
    pub patient_id: String,
    pub clinician_id: String,
    pub reason: String,
    pub starts_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

impl BreakGlassGrantEntity {
    /// Whether the grant covers `now`.
    pub fn is_active(&self, now: DateTime<Utc>) -> bool {
        self.starts_at <= now && now < self.expires_at
    }

    /// Whether the grant is well formed: a reason, and time-limited within
    /// [`MAX_BREAK_GLASS_HOURS`] (the table's CHECK, applied in memory too).
    pub fn is_valid(&self) -> bool {
        let reason = self.reason.trim().chars().count();
        (10..=500).contains(&reason)
            && self.expires_at > self.starts_at
            && self.expires_at <= self.starts_at + chrono::Duration::hours(MAX_BREAK_GLASS_HOURS)
    }
}

/// A server-issued chart access context (WP10): the declared reason for
/// opening a chart, recorded against the authority that allowed it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct AccessContextEntity {
    pub id: String,
    pub patient_id: String,
    pub clinician_id: String,
    pub reason: String,
    pub authority_type: String,
    pub authority_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl AccessContextEntity {
    /// Whether this context lets `clinician` cite it for `patient_id` at `now`.
    pub fn covers(&self, clinician: &str, patient_id: &str, now: DateTime<Utc>) -> bool {
        self.clinician_id == clinician && self.patient_id == patient_id && now < self.expires_at
    }
}

/// Storage for care relationships and break-glass grants.
#[async_trait]
pub trait CareRelationshipRepository: Send + Sync + fmt::Debug {
    /// Record a relationship; the same (source, source id, clinician) again
    /// refreshes its window instead of adding a row.
    async fn record(&self, row: CareRelationshipEntity)
        -> RepositoryResult<CareRelationshipEntity>;
    /// An active relationship between the patient and the clinician (or the
    /// clinician's facility), if any.
    async fn active_for(
        &self,
        patient_id: &str,
        clinician_id: &str,
        facility_id: Option<&str>,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<CareRelationshipEntity>>;
    /// One relationship by id.
    async fn get_relationship(&self, id: &str) -> RepositoryResult<Option<CareRelationshipEntity>>;
    /// Store a new break-glass grant.
    async fn create_break_glass(
        &self,
        row: BreakGlassGrantEntity,
    ) -> RepositoryResult<BreakGlassGrantEntity>;
    /// An active break-glass grant for the clinician on the patient, if any.
    async fn active_break_glass(
        &self,
        patient_id: &str,
        clinician_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<BreakGlassGrantEntity>>;
    /// Store a chart access context (WP10).
    async fn create_access_context(
        &self,
        row: AccessContextEntity,
    ) -> RepositoryResult<AccessContextEntity>;
    /// One access context by id, or `None`.
    async fn get_access_context(&self, id: &str) -> RepositoryResult<Option<AccessContextEntity>>;
}

/// In-memory rows.
#[derive(Debug, Default)]
pub struct MemoryCareRelationshipRepository {
    relationships: RwLock<HashMap<String, CareRelationshipEntity>>,
    break_glass: RwLock<HashMap<String, BreakGlassGrantEntity>>,
    access_contexts: RwLock<HashMap<String, AccessContextEntity>>,
}

impl MemoryCareRelationshipRepository {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }
}

/// Map a poisoned lock to a storage error rather than panicking a worker.
fn lock_error<T>(error: std::sync::PoisonError<T>) -> RepositoryError {
    RepositoryError::Database(error.to_string())
}

/// Whether `row` is between this patient and this clinician or facility.
fn concerns(
    row: &CareRelationshipEntity,
    patient_id: &str,
    clinician_id: &str,
    facility_id: Option<&str>,
) -> bool {
    row.patient_id == patient_id
        && (row.clinician_id.as_deref() == Some(clinician_id)
            || (facility_id.is_some() && row.facility_id.as_deref() == facility_id))
}

#[async_trait]
impl CareRelationshipRepository for MemoryCareRelationshipRepository {
    async fn record(
        &self,
        row: CareRelationshipEntity,
    ) -> RepositoryResult<CareRelationshipEntity> {
        if row.clinician_id.is_none() && row.facility_id.is_none() {
            return Err(RepositoryError::Validation(
                "a relationship must name someone".into(),
            ));
        }
        let mut rows = self.relationships.write().map_err(lock_error)?;
        let existing = rows.values().find(|r| {
            r.source == row.source
                && r.source_id == row.source_id
                && r.clinician_id == row.clinician_id
        });
        let stored = match existing {
            Some(found) => CareRelationshipEntity {
                id: found.id.clone(),
                created_at: found.created_at,
                ..row
            },
            None => row,
        };
        rows.insert(stored.id.clone(), stored.clone());
        Ok(stored)
    }

    async fn active_for(
        &self,
        patient_id: &str,
        clinician_id: &str,
        facility_id: Option<&str>,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<CareRelationshipEntity>> {
        let rows = self.relationships.read().map_err(lock_error)?;
        Ok(rows
            .values()
            .filter(|r| concerns(r, patient_id, clinician_id, facility_id) && r.is_active(now))
            .max_by_key(|r| r.starts_at)
            .cloned())
    }

    async fn get_relationship(&self, id: &str) -> RepositoryResult<Option<CareRelationshipEntity>> {
        Ok(self
            .relationships
            .read()
            .map_err(lock_error)?
            .get(id)
            .cloned())
    }

    async fn create_break_glass(
        &self,
        row: BreakGlassGrantEntity,
    ) -> RepositoryResult<BreakGlassGrantEntity> {
        if !row.is_valid() {
            return Err(RepositoryError::Validation(
                "a break-glass grant needs a reason and a time limit".into(),
            ));
        }
        let mut rows = self.break_glass.write().map_err(lock_error)?;
        if rows.contains_key(&row.id) {
            return Err(RepositoryError::Duplicate(row.id));
        }
        rows.insert(row.id.clone(), row.clone());
        Ok(row)
    }

    async fn active_break_glass(
        &self,
        patient_id: &str,
        clinician_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<BreakGlassGrantEntity>> {
        let rows = self.break_glass.read().map_err(lock_error)?;
        Ok(rows
            .values()
            .filter(|g| {
                g.patient_id == patient_id && g.clinician_id == clinician_id && g.is_active(now)
            })
            .max_by_key(|g| g.expires_at)
            .cloned())
    }

    async fn create_access_context(
        &self,
        row: AccessContextEntity,
    ) -> RepositoryResult<AccessContextEntity> {
        let bounded = row.expires_at > row.created_at
            && row.expires_at <= row.created_at + chrono::Duration::hours(MAX_BREAK_GLASS_HOURS);
        let reason = row.reason.trim().chars().count();
        if !bounded || !(1..=140).contains(&reason) {
            return Err(RepositoryError::Validation(
                "an access context needs a reason and a limit".into(),
            ));
        }
        let mut rows = self.access_contexts.write().map_err(lock_error)?;
        rows.insert(row.id.clone(), row.clone());
        Ok(row)
    }

    async fn get_access_context(&self, id: &str) -> RepositoryResult<Option<AccessContextEntity>> {
        Ok(self
            .access_contexts
            .read()
            .map_err(lock_error)?
            .get(id)
            .cloned())
    }
}

#[cfg(feature = "postgres")]
pub use pg::PgCareRelationshipRepository;

#[cfg(feature = "postgres")]
pub(crate) mod pg {
    //! PostgreSQL rows. Every value is bound.

    use super::*;
    use sqlx::PgPool;

    const RELATIONSHIP_COLUMNS: &str =
        "id, patient_id, clinician_id, facility_id, source, source_id, starts_at, ends_at, created_at";
    const BREAK_GLASS_COLUMNS: &str =
        "id, patient_id, clinician_id, reason, starts_at, expires_at, created_at";
    const CONTEXT_COLUMNS: &str = "id, patient_id, clinician_id, reason, authority_type, \
        authority_id, created_at, expires_at";

    /// PostgreSQL-backed [`CareRelationshipRepository`].
    #[derive(Debug, Clone)]
    pub struct PgCareRelationshipRepository {
        pool: PgPool,
    }

    impl PgCareRelationshipRepository {
        /// Wrap a pool.
        pub fn new(pool: PgPool) -> Self {
            Self { pool }
        }
    }

    /// Insert a break-glass grant inside a caller's transaction.
    pub(crate) async fn insert_break_glass(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        row: &BreakGlassGrantEntity,
    ) -> RepositoryResult<BreakGlassGrantEntity> {
        let sql = format!(
            "INSERT INTO break_glass_grants ({BREAK_GLASS_COLUMNS})
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {BREAK_GLASS_COLUMNS}"
        );
        Ok(sqlx::query_as::<_, BreakGlassGrantEntity>(&sql)
            .bind(&row.id)
            .bind(&row.patient_id)
            .bind(&row.clinician_id)
            .bind(&row.reason)
            .bind(row.starts_at)
            .bind(row.expires_at)
            .bind(row.created_at)
            .fetch_one(&mut **tx)
            .await?)
    }

    #[async_trait]
    impl CareRelationshipRepository for PgCareRelationshipRepository {
        async fn record(
            &self,
            row: CareRelationshipEntity,
        ) -> RepositoryResult<CareRelationshipEntity> {
            let sql = format!(
                "INSERT INTO care_relationships ({RELATIONSHIP_COLUMNS})
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (source, source_id, clinician_id) DO UPDATE
                    SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
                        facility_id = EXCLUDED.facility_id
                 RETURNING {RELATIONSHIP_COLUMNS}"
            );
            Ok(sqlx::query_as::<_, CareRelationshipEntity>(&sql)
                .bind(&row.id)
                .bind(&row.patient_id)
                .bind(&row.clinician_id)
                .bind(&row.facility_id)
                .bind(&row.source)
                .bind(&row.source_id)
                .bind(row.starts_at)
                .bind(row.ends_at)
                .bind(row.created_at)
                .fetch_one(&self.pool)
                .await?)
        }

        async fn active_for(
            &self,
            patient_id: &str,
            clinician_id: &str,
            facility_id: Option<&str>,
            now: DateTime<Utc>,
        ) -> RepositoryResult<Option<CareRelationshipEntity>> {
            let sql = format!(
                "SELECT {RELATIONSHIP_COLUMNS} FROM care_relationships
                 WHERE patient_id = $1
                   AND (clinician_id = $2 OR ($3::text IS NOT NULL AND facility_id = $3))
                   AND starts_at <= $4 AND (ends_at IS NULL OR ends_at > $4)
                 ORDER BY starts_at DESC LIMIT 1"
            );
            Ok(sqlx::query_as::<_, CareRelationshipEntity>(&sql)
                .bind(patient_id)
                .bind(clinician_id)
                .bind(facility_id)
                .bind(now)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn get_relationship(
            &self,
            id: &str,
        ) -> RepositoryResult<Option<CareRelationshipEntity>> {
            let sql =
                format!("SELECT {RELATIONSHIP_COLUMNS} FROM care_relationships WHERE id = $1");
            Ok(sqlx::query_as::<_, CareRelationshipEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn create_break_glass(
            &self,
            row: BreakGlassGrantEntity,
        ) -> RepositoryResult<BreakGlassGrantEntity> {
            let mut tx = self.pool.begin().await?;
            let stored = insert_break_glass(&mut tx, &row).await?;
            tx.commit().await?;
            Ok(stored)
        }

        async fn active_break_glass(
            &self,
            patient_id: &str,
            clinician_id: &str,
            now: DateTime<Utc>,
        ) -> RepositoryResult<Option<BreakGlassGrantEntity>> {
            let sql = format!(
                "SELECT {BREAK_GLASS_COLUMNS} FROM break_glass_grants
                 WHERE patient_id = $1 AND clinician_id = $2
                   AND starts_at <= $3 AND expires_at > $3
                 ORDER BY expires_at DESC LIMIT 1"
            );
            Ok(sqlx::query_as::<_, BreakGlassGrantEntity>(&sql)
                .bind(patient_id)
                .bind(clinician_id)
                .bind(now)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn create_access_context(
            &self,
            row: AccessContextEntity,
        ) -> RepositoryResult<AccessContextEntity> {
            let sql = format!(
                "INSERT INTO access_contexts ({CONTEXT_COLUMNS})
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {CONTEXT_COLUMNS}"
            );
            Ok(sqlx::query_as::<_, AccessContextEntity>(&sql)
                .bind(&row.id)
                .bind(&row.patient_id)
                .bind(&row.clinician_id)
                .bind(&row.reason)
                .bind(&row.authority_type)
                .bind(&row.authority_id)
                .bind(row.created_at)
                .bind(row.expires_at)
                .fetch_one(&self.pool)
                .await?)
        }

        async fn get_access_context(
            &self,
            id: &str,
        ) -> RepositoryResult<Option<AccessContextEntity>> {
            let sql = format!("SELECT {CONTEXT_COLUMNS} FROM access_contexts WHERE id = $1");
            Ok(sqlx::query_as::<_, AccessContextEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn relationship(id: &str, source_id: &str, days: i64) -> CareRelationshipEntity {
        let now = Utc::now();
        CareRelationshipEntity {
            id: id.into(),
            patient_id: "PAT-CARE".into(),
            clinician_id: Some("doctor_care".into()),
            facility_id: None,
            source: "encounter".into(),
            source_id: source_id.into(),
            starts_at: now - chrono::Duration::hours(1),
            ends_at: Some(now + chrono::Duration::days(days)),
            created_at: now,
        }
    }

    pub(crate) fn break_glass(id: &str, hours: i64) -> BreakGlassGrantEntity {
        let now = Utc::now();
        BreakGlassGrantEntity {
            id: id.into(),
            patient_id: "PAT-CARE".into(),
            clinician_id: "doctor_stranger".into(),
            reason: "Unconscious patient in resus".into(),
            starts_at: now,
            expires_at: now + chrono::Duration::hours(hours),
            created_at: now,
        }
    }

    #[tokio::test]
    async fn a_relationship_is_active_only_in_its_window_and_refreshes_in_place() {
        let repo = MemoryCareRelationshipRepository::new();
        repo.record(relationship("REL-1", "APT-1", 30))
            .await
            .unwrap();
        let again = repo
            .record(relationship("REL-2", "APT-1", 60))
            .await
            .unwrap();
        assert_eq!(again.id, "REL-1", "same source refreshes the same row");
        let now = Utc::now();
        assert!(repo
            .active_for("PAT-CARE", "doctor_care", None, now)
            .await
            .unwrap()
            .is_some());
        assert!(repo
            .active_for("PAT-CARE", "doctor_other", None, now)
            .await
            .unwrap()
            .is_none());
        let later = now + chrono::Duration::days(61);
        assert!(repo
            .active_for("PAT-CARE", "doctor_care", None, later)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn break_glass_must_be_reasoned_and_time_limited() {
        let repo = MemoryCareRelationshipRepository::new();
        assert!(repo
            .create_break_glass(break_glass("BG-LONG", 13))
            .await
            .is_err());
        let mut terse = break_glass("BG-TERSE", 1);
        terse.reason = "urgent".into();
        assert!(repo.create_break_glass(terse).await.is_err());
        repo.create_break_glass(break_glass("BG-OK", 1))
            .await
            .unwrap();
        let now = Utc::now();
        assert!(repo
            .active_break_glass("PAT-CARE", "doctor_stranger", now)
            .await
            .unwrap()
            .is_some());
        let later = now + chrono::Duration::hours(2);
        assert!(repo
            .active_break_glass("PAT-CARE", "doctor_stranger", later)
            .await
            .unwrap()
            .is_none());
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::tests::{break_glass, relationship};
    use super::*;

    /// The database refuses an open-ended break-glass and a relationship that
    /// names nobody; the same appointment re-recorded refreshes one row.
    #[tokio::test]
    async fn test_pg_care_rules_hold_in_the_database() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        sqlx::query(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type)
             VALUES ('PAT-CARE', 'PAT-CARE', 'test-hash', 'SmartID') ON CONFLICT (id) DO NOTHING",
        )
        .execute(&pool)
        .await
        .unwrap();
        let repo = PgCareRelationshipRepository::new(pool.clone());
        let source = format!("APT-{}", uuid::Uuid::new_v4());
        let first = repo
            .record(relationship(
                &format!("REL-{}", uuid::Uuid::new_v4()),
                &source,
                30,
            ))
            .await
            .unwrap();
        let again = repo
            .record(relationship(
                &format!("REL-{}", uuid::Uuid::new_v4()),
                &source,
                60,
            ))
            .await
            .unwrap();
        assert_eq!(first.id, again.id);
        let mut nobody = relationship(&format!("REL-{}", uuid::Uuid::new_v4()), "APT-NOBODY", 1);
        nobody.clinician_id = None;
        assert!(repo.record(nobody).await.is_err());
        // Bypass the in-memory check: this is the table's own CHECK.
        let mut tx = pool.begin().await.unwrap();
        let long = break_glass(&format!("BG-{}", uuid::Uuid::new_v4()), 13);
        assert!(pg::insert_break_glass(&mut tx, &long).await.is_err());
        drop(tx);
        repo.create_break_glass(break_glass(&format!("BG-{}", uuid::Uuid::new_v4()), 1))
            .await
            .unwrap();
        // An access context is bounded to a shift by the table itself.
        let now = Utc::now();
        let context = |hours: i64| AccessContextEntity {
            id: format!("ACX-{}", uuid::Uuid::new_v4()),
            patient_id: "PAT-CARE".into(),
            clinician_id: "doctor_care".into(),
            reason: "Treatment".into(),
            authority_type: "care_relationship".into(),
            authority_id: None,
            created_at: now,
            expires_at: now + chrono::Duration::hours(hours),
        };
        assert!(repo.create_access_context(context(13)).await.is_err());
        let stored = repo.create_access_context(context(8)).await.unwrap();
        assert!(repo.get_access_context(&stored.id).await.unwrap().is_some());
        pool.close().await;
    }
}
