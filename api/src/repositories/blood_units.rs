//! Blood-unit stock (WP7.5): one row per physical unit, with a guarded status
//! machine. `available → reserved → issued`, `reserved → available`, and any
//! unissued unit → `discarded`. Every transition is one guarded statement, so
//! two technicians cannot reserve or issue the same unit, and the table's
//! CHECKs (`20260926000006_blood_units.sql`) refuse an expired unit being
//! reserved or issued whatever the handler decided. The memory backend
//! mirrors the same guards.

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;

use super::traits::{RepositoryError, RepositoryResult};

/// Most units one listing returns, so no read is unbounded.
pub const MAX_UNITS_PER_READ: usize = 2_000;

/// One blood unit, column for column.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct BloodUnitEntity {
    pub id: String,
    pub unit_number: String,
    pub product_type: String,
    pub abo: String,
    pub rh: String,
    pub collected_on: NaiveDate,
    pub expires_on: NaiveDate,
    pub status: String,
    pub location: String,
    pub reserved_for_patient_id: Option<String>,
    pub crossmatch_reference: Option<String>,
    pub reserved_at: Option<DateTime<Utc>>,
    pub issued_to_patient_id: Option<String>,
    pub transfusion_id: Option<String>,
    pub issued_at: Option<DateTime<Utc>>,
    pub discard_reason: Option<String>,
    pub received_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A change to a unit's status. Each applies only from its allowed states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnitTransition {
    /// available → reserved, for a patient, after crossmatch; unexpired only.
    Reserve {
        patient_id: String,
        crossmatch_reference: String,
    },
    /// reserved → available.
    Release,
    /// reserved (for this patient) → issued, linked to a transfusion; unexpired only.
    Issue {
        patient_id: String,
        transfusion_id: String,
    },
    /// any unissued state → discarded, with a reason.
    Discard { reason: String },
}

/// Storage for blood units.
#[async_trait]
pub trait BloodUnitRepository: Send + Sync + fmt::Debug {
    /// Store a newly received unit. `Duplicate` when the unit number exists.
    async fn create(&self, unit: BloodUnitEntity) -> RepositoryResult<BloodUnitEntity>;
    /// One unit by id, or `None`.
    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<BloodUnitEntity>>;
    /// Every unit, soonest expiry first, at most [`MAX_UNITS_PER_READ`].
    async fn list(&self) -> RepositoryResult<Vec<BloodUnitEntity>>;
    /// Apply `transition` at `at` if the unit is in an allowed state.
    /// `None` when it was not (already taken, expired, wrong patient, ...).
    async fn apply(
        &self,
        id: &str,
        transition: &UnitTransition,
        at: DateTime<Utc>,
    ) -> RepositoryResult<Option<BloodUnitEntity>>;
}

/// Whether `transition` may apply to `unit` at `at` (the memory backend's
/// version of the SQL guards).
fn allowed(unit: &BloodUnitEntity, transition: &UnitTransition, at: DateTime<Utc>) -> bool {
    let unexpired = at.date_naive() <= unit.expires_on;
    match transition {
        UnitTransition::Reserve { .. } => unit.status == "available" && unexpired,
        UnitTransition::Release => unit.status == "reserved",
        UnitTransition::Issue { patient_id, .. } => {
            unit.status == "reserved"
                && unit.reserved_for_patient_id.as_deref() == Some(patient_id.as_str())
                && unexpired
        }
        UnitTransition::Discard { .. } => {
            matches!(unit.status.as_str(), "available" | "reserved" | "expired")
        }
    }
}

/// Apply an allowed transition's field changes to `unit`.
fn transform(unit: &mut BloodUnitEntity, transition: &UnitTransition, at: DateTime<Utc>) {
    match transition {
        UnitTransition::Reserve {
            patient_id,
            crossmatch_reference,
        } => {
            unit.status = "reserved".into();
            unit.reserved_for_patient_id = Some(patient_id.clone());
            unit.crossmatch_reference = Some(crossmatch_reference.clone());
            unit.reserved_at = Some(at);
        }
        UnitTransition::Release => {
            unit.status = "available".into();
            (
                unit.reserved_for_patient_id,
                unit.crossmatch_reference,
                unit.reserved_at,
            ) = (None, None, None);
        }
        UnitTransition::Issue {
            patient_id,
            transfusion_id,
        } => {
            unit.status = "issued".into();
            unit.issued_to_patient_id = Some(patient_id.clone());
            unit.transfusion_id = Some(transfusion_id.clone());
            unit.issued_at = Some(at);
        }
        UnitTransition::Discard { reason } => {
            unit.status = "discarded".into();
            unit.discard_reason = Some(reason.clone());
        }
    }
    unit.updated_at = at;
}

/// In-memory blood units.
#[derive(Debug, Default)]
pub struct MemoryBloodUnitRepository {
    units: RwLock<HashMap<String, BloodUnitEntity>>,
}

impl MemoryBloodUnitRepository {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }
}

/// Map a poisoned lock to a storage error rather than panicking a worker.
fn lock_error<T>(error: std::sync::PoisonError<T>) -> RepositoryError {
    RepositoryError::Database(error.to_string())
}

#[async_trait]
impl BloodUnitRepository for MemoryBloodUnitRepository {
    async fn create(&self, unit: BloodUnitEntity) -> RepositoryResult<BloodUnitEntity> {
        let mut units = self.units.write().map_err(lock_error)?;
        if units.values().any(|u| u.unit_number == unit.unit_number) || units.contains_key(&unit.id)
        {
            return Err(RepositoryError::Duplicate(unit.unit_number));
        }
        units.insert(unit.id.clone(), unit.clone());
        Ok(unit)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<BloodUnitEntity>> {
        Ok(self.units.read().map_err(lock_error)?.get(id).cloned())
    }

    async fn list(&self) -> RepositoryResult<Vec<BloodUnitEntity>> {
        let mut all: Vec<_> = self
            .units
            .read()
            .map_err(lock_error)?
            .values()
            .cloned()
            .collect();
        all.sort_by(|a, b| {
            a.expires_on
                .cmp(&b.expires_on)
                .then(a.unit_number.cmp(&b.unit_number))
        });
        all.truncate(MAX_UNITS_PER_READ);
        Ok(all)
    }

    async fn apply(
        &self,
        id: &str,
        transition: &UnitTransition,
        at: DateTime<Utc>,
    ) -> RepositoryResult<Option<BloodUnitEntity>> {
        let mut units = self.units.write().map_err(lock_error)?;
        let Some(unit) = units.get_mut(id) else {
            return Ok(None);
        };
        if !allowed(unit, transition, at) {
            return Ok(None);
        }
        transform(unit, transition, at);
        Ok(Some(unit.clone()))
    }
}

#[cfg(feature = "postgres")]
pub use pg::PgBloodUnitRepository;

#[cfg(feature = "postgres")]
pub(crate) mod pg {
    //! PostgreSQL blood units. Every value is bound; each transition is one
    //! guarded UPDATE.

    use super::*;
    use sqlx::PgPool;

    pub(crate) const COLUMNS: &str = "id, unit_number, product_type, abo, rh, collected_on, \
        expires_on, status, location, reserved_for_patient_id, crossmatch_reference, reserved_at, \
        issued_to_patient_id, transfusion_id, issued_at, discard_reason, received_by, created_at, \
        updated_at";

    /// PostgreSQL-backed [`BloodUnitRepository`].
    #[derive(Debug, Clone)]
    pub struct PgBloodUnitRepository {
        pool: PgPool,
    }

    impl PgBloodUnitRepository {
        /// Wrap a pool.
        pub fn new(pool: PgPool) -> Self {
            Self { pool }
        }
    }

    /// Insert a received unit inside a caller's transaction.
    pub(crate) async fn insert_unit(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        unit: &BloodUnitEntity,
    ) -> RepositoryResult<BloodUnitEntity> {
        let sql = format!(
            "INSERT INTO blood_units
                (id, unit_number, product_type, abo, rh, collected_on, expires_on, status,
                 location, received_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', $8, $9, $10, $10)
             RETURNING {COLUMNS}"
        );
        Ok(sqlx::query_as::<_, BloodUnitEntity>(&sql)
            .bind(&unit.id)
            .bind(&unit.unit_number)
            .bind(&unit.product_type)
            .bind(&unit.abo)
            .bind(&unit.rh)
            .bind(unit.collected_on)
            .bind(unit.expires_on)
            .bind(&unit.location)
            .bind(&unit.received_by)
            .bind(unit.created_at)
            .fetch_one(&mut **tx)
            .await?)
    }

    /// Apply a transition inside a caller's transaction, guarded on state.
    pub(crate) async fn apply_transition(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        id: &str,
        transition: &UnitTransition,
        at: DateTime<Utc>,
    ) -> RepositoryResult<Option<BloodUnitEntity>> {
        let (set, guard, first, second) = match transition {
            UnitTransition::Reserve { patient_id, crossmatch_reference } => (
                "status = 'reserved', reserved_for_patient_id = $3, crossmatch_reference = $4, reserved_at = $2",
                "status = 'available' AND expires_on >= $2::date",
                Some(patient_id.as_str()),
                Some(crossmatch_reference.as_str()),
            ),
            UnitTransition::Release => (
                "status = 'available', reserved_for_patient_id = NULL, crossmatch_reference = NULL, reserved_at = NULL",
                "status = 'reserved' AND ($3::text IS NULL) AND ($4::text IS NULL)",
                None,
                None,
            ),
            UnitTransition::Issue { patient_id, transfusion_id } => (
                "status = 'issued', issued_to_patient_id = $3, transfusion_id = $4, issued_at = $2",
                "status = 'reserved' AND reserved_for_patient_id = $3 AND expires_on >= $2::date",
                Some(patient_id.as_str()),
                Some(transfusion_id.as_str()),
            ),
            UnitTransition::Discard { reason } => (
                "status = 'discarded', discard_reason = $3",
                "status IN ('available', 'reserved', 'expired') AND ($4::text IS NULL)",
                Some(reason.as_str()),
                None,
            ),
        };
        let sql = format!(
            "UPDATE blood_units SET {set}, updated_at = $2 WHERE id = $1 AND {guard} RETURNING {COLUMNS}"
        );
        Ok(sqlx::query_as::<_, BloodUnitEntity>(&sql)
            .bind(id)
            .bind(at)
            .bind(first)
            .bind(second)
            .fetch_optional(&mut **tx)
            .await?)
    }

    #[async_trait]
    impl BloodUnitRepository for PgBloodUnitRepository {
        async fn create(&self, unit: BloodUnitEntity) -> RepositoryResult<BloodUnitEntity> {
            let mut tx = self.pool.begin().await?;
            let stored = insert_unit(&mut tx, &unit).await?;
            tx.commit().await?;
            Ok(stored)
        }

        async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<BloodUnitEntity>> {
            let sql = format!("SELECT {COLUMNS} FROM blood_units WHERE id = $1");
            Ok(sqlx::query_as::<_, BloodUnitEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn list(&self) -> RepositoryResult<Vec<BloodUnitEntity>> {
            let sql = format!(
                "SELECT {COLUMNS} FROM blood_units ORDER BY expires_on ASC, unit_number ASC LIMIT $1"
            );
            Ok(sqlx::query_as::<_, BloodUnitEntity>(&sql)
                .bind(MAX_UNITS_PER_READ as i64)
                .fetch_all(&self.pool)
                .await?)
        }

        async fn apply(
            &self,
            id: &str,
            transition: &UnitTransition,
            at: DateTime<Utc>,
        ) -> RepositoryResult<Option<BloodUnitEntity>> {
            let mut tx = self.pool.begin().await?;
            let changed = apply_transition(&mut tx, id, transition, at).await?;
            tx.commit().await?;
            Ok(changed)
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A received, available unit expiring on `expires`.
    pub(crate) fn unit(id: &str, number: &str, expires: NaiveDate) -> BloodUnitEntity {
        let now = Utc::now();
        BloodUnitEntity {
            id: id.into(),
            unit_number: number.into(),
            product_type: "PackedRBC".into(),
            abo: "O".into(),
            rh: "negative".into(),
            collected_on: expires - chrono::Duration::days(35),
            expires_on: expires,
            status: "available".into(),
            location: "Fridge 1".into(),
            reserved_for_patient_id: None,
            crossmatch_reference: None,
            reserved_at: None,
            issued_to_patient_id: None,
            transfusion_id: None,
            issued_at: None,
            discard_reason: None,
            received_by: "tech".into(),
            created_at: now,
            updated_at: now,
        }
    }

    fn reserve(patient: &str) -> UnitTransition {
        UnitTransition::Reserve {
            patient_id: patient.into(),
            crossmatch_reference: "XM-1".into(),
        }
    }

    #[tokio::test]
    async fn a_unit_moves_reserve_issue_and_cannot_be_issued_twice() {
        let repo = MemoryBloodUnitRepository::new();
        let expires = Utc::now().date_naive() + chrono::Duration::days(10);
        repo.create(unit("U1", "ZA1000001", expires)).await.unwrap();
        let now = Utc::now();
        assert!(repo
            .apply("U1", &reserve("PAT-1"), now)
            .await
            .unwrap()
            .is_some());
        assert!(
            repo.apply("U1", &reserve("PAT-2"), now)
                .await
                .unwrap()
                .is_none(),
            "already reserved"
        );
        let wrong = UnitTransition::Issue {
            patient_id: "PAT-2".into(),
            transfusion_id: "TX-1".into(),
        };
        assert!(
            repo.apply("U1", &wrong, now).await.unwrap().is_none(),
            "reserved for someone else"
        );
        let issue = UnitTransition::Issue {
            patient_id: "PAT-1".into(),
            transfusion_id: "TX-1".into(),
        };
        assert_eq!(
            repo.apply("U1", &issue, now).await.unwrap().unwrap().status,
            "issued"
        );
        assert!(repo.apply("U1", &issue, now).await.unwrap().is_none());
        let discard = UnitTransition::Discard {
            reason: "broken bag".into(),
        };
        assert!(
            repo.apply("U1", &discard, now).await.unwrap().is_none(),
            "issued units stay issued"
        );
    }

    #[tokio::test]
    async fn an_expired_unit_cannot_be_reserved_and_numbers_are_unique() {
        let repo = MemoryBloodUnitRepository::new();
        let yesterday = Utc::now().date_naive() - chrono::Duration::days(1);
        repo.create(unit("U2", "ZA1000002", yesterday))
            .await
            .unwrap();
        assert!(repo
            .apply("U2", &reserve("PAT-1"), Utc::now())
            .await
            .unwrap()
            .is_none());
        let duplicate = repo.create(unit("U3", "ZA1000002", yesterday)).await;
        assert!(matches!(duplicate, Err(RepositoryError::Duplicate(_))));
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;

    /// The rules hold in the database itself: a direct UPDATE that skips the
    /// repository's guards still cannot issue an expired unit, and unit
    /// numbers stay unique.
    #[tokio::test]
    async fn test_pg_blood_unit_rules_hold_in_the_database() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        sqlx::query(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type)
             VALUES ('PAT-BU', 'PAT-BU', 'test-hash', 'SmartID') ON CONFLICT (id) DO NOTHING",
        )
        .execute(&pool)
        .await
        .unwrap();
        let repo = PgBloodUnitRepository::new(pool.clone());
        let yesterday = Utc::now().date_naive() - chrono::Duration::days(1);
        repo.create(tests::unit("BU-PG-1", "ZAPG00001", yesterday))
            .await
            .unwrap();
        let duplicate = repo
            .create(tests::unit("BU-PG-2", "ZAPG00001", yesterday))
            .await;
        assert!(matches!(duplicate, Err(RepositoryError::Duplicate(_))));
        let forced = sqlx::query(
            "UPDATE blood_units SET status = 'issued', issued_to_patient_id = 'PAT-BU',
                    transfusion_id = 'TX-1', issued_at = NOW()
             WHERE id = 'BU-PG-1'",
        )
        .execute(&pool)
        .await;
        assert!(
            forced.is_err(),
            "the expiry CHECK must refuse issuing an expired unit"
        );
        let reserve = UnitTransition::Reserve {
            patient_id: "PAT-BU".into(),
            crossmatch_reference: "XM-1".into(),
        };
        assert!(repo
            .apply("BU-PG-1", &reserve, Utc::now())
            .await
            .unwrap()
            .is_none());
        pool.close().await;
    }
}
