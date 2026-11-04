//! Wards, the clinicians rostered on them, and the patients admitted to them
//! (UX plan Phase 5).
//!
//! Together these answer "which patients is this nurse looking after right
//! now?": a patient with an open admission to ward W, and a clinician with an
//! uncancelled shift on W covering now. That answer is a chart authority of its
//! own (`ward_assignment`, see `care_access.rs`), so it is computed by one query
//! the database can index rather than assembled in the handler.
//!
//! The rules the tables enforce (shift ≤ 24 h, one open admission per patient,
//! a discharge names who discharged) are enforced by the in-memory store too:
//! a rule only PostgreSQL checks is a rule demo mode silently breaks.

use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;

use super::traits::{RepositoryError, RepositoryResult};

/// Longest shift the roster accepts (the table's CHECK agrees).
pub const MAX_SHIFT_HOURS: i64 = 24;
/// The ward kinds the table accepts.
pub const WARD_KINDS: &[&str] = &[
    "general",
    "emergency",
    "icu",
    "maternity",
    "paediatric",
    "surgical",
    "other",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct WardEntity {
    pub id: String,
    pub facility_id: String,
    pub name: String,
    pub kind: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub retired_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ShiftAssignmentEntity {
    pub id: String,
    pub ward_id: String,
    pub clinician_id: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub assigned_by: String,
    pub created_at: DateTime<Utc>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancelled_by: Option<String>,
}

impl ShiftAssignmentEntity {
    /// Whether the shift covers `now` and has not been cancelled.
    pub fn is_on(&self, now: DateTime<Utc>) -> bool {
        self.cancelled_at.is_none() && self.starts_at <= now && now < self.ends_at
    }

    /// The table's CHECKs, applied in memory too.
    pub fn is_valid(&self) -> bool {
        self.ends_at > self.starts_at
            && self.ends_at - self.starts_at <= Duration::hours(MAX_SHIFT_HOURS)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct AdmissionEntity {
    pub id: String,
    pub patient_id: String,
    pub ward_id: String,
    pub bed_label: Option<String>,
    pub admitted_at: DateTime<Utc>,
    pub admitted_by: String,
    pub discharged_at: Option<DateTime<Utc>>,
    pub discharged_by: Option<String>,
}

/// What authorised a ward-based chart read: the admission and the shift.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WardAuthority {
    pub admission_id: String,
    pub assignment_id: String,
}

#[async_trait]
pub trait WardRepository: Send + Sync + fmt::Debug {
    /// A new ward; `Duplicate` when the facility already has one of that name.
    async fn create_ward(&self, ward: WardEntity) -> RepositoryResult<WardEntity>;
    /// Wards in service, optionally at one facility.
    async fn list_wards(&self, facility_id: Option<&str>) -> RepositoryResult<Vec<WardEntity>>;
    async fn get_ward(&self, id: &str) -> RepositoryResult<Option<WardEntity>>;
    /// Roster a clinician on a ward for one shift.
    async fn assign_shift(
        &self,
        shift: ShiftAssignmentEntity,
    ) -> RepositoryResult<ShiftAssignmentEntity>;
    async fn get_shift(&self, id: &str) -> RepositoryResult<Option<ShiftAssignmentEntity>>;
    /// Cancel a shift that is not already cancelled; `None` when it was.
    async fn cancel_shift(
        &self,
        id: &str,
        by: &str,
        at: DateTime<Utc>,
    ) -> RepositoryResult<Option<ShiftAssignmentEntity>>;
    /// Shifts on a ward overlapping `[from, to)`, cancelled ones included.
    async fn shifts_on_ward(
        &self,
        ward_id: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> RepositoryResult<Vec<ShiftAssignmentEntity>>;
    /// The clinician's shifts covering `now`.
    async fn current_shifts_of(
        &self,
        clinician_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Vec<ShiftAssignmentEntity>>;
    /// Admit; `Duplicate` when the patient already has an open admission.
    async fn admit(&self, admission: AdmissionEntity) -> RepositoryResult<AdmissionEntity>;
    async fn get_admission(&self, id: &str) -> RepositoryResult<Option<AdmissionEntity>>;
    /// Discharge an open admission; `None` when it was already discharged.
    async fn discharge(
        &self,
        id: &str,
        by: &str,
        at: DateTime<Utc>,
    ) -> RepositoryResult<Option<AdmissionEntity>>;
    /// Every admission of a patient, newest first.
    async fn admissions_of_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AdmissionEntity>>;
    /// Open admissions on any of these wards.
    async fn open_admissions_on(
        &self,
        ward_ids: &[String],
    ) -> RepositoryResult<Vec<AdmissionEntity>>;
    /// The admission and shift that let `clinician_id` read `patient_id` now, if any.
    async fn ward_authority(
        &self,
        patient_id: &str,
        clinician_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<WardAuthority>>;
}

/// In-memory store for dev and demo.
#[derive(Debug, Default)]
pub struct MemoryWardRepository {
    wards: RwLock<HashMap<String, WardEntity>>,
    shifts: RwLock<HashMap<String, ShiftAssignmentEntity>>,
    admissions: RwLock<HashMap<String, AdmissionEntity>>,
}

impl MemoryWardRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> RepositoryError {
    RepositoryError::Database(error.to_string())
}

#[async_trait]
impl WardRepository for MemoryWardRepository {
    async fn create_ward(&self, ward: WardEntity) -> RepositoryResult<WardEntity> {
        let mut wards = self.wards.write().map_err(lock_error)?;
        let clash = wards.values().any(|w| {
            w.retired_at.is_none()
                && w.facility_id == ward.facility_id
                && w.name.eq_ignore_ascii_case(&ward.name)
        });
        if clash {
            return Err(RepositoryError::Duplicate(
                "a ward of that name already exists here".into(),
            ));
        }
        wards.insert(ward.id.clone(), ward.clone());
        Ok(ward)
    }

    async fn list_wards(&self, facility_id: Option<&str>) -> RepositoryResult<Vec<WardEntity>> {
        let wards = self.wards.read().map_err(lock_error)?;
        let mut list: Vec<WardEntity> = wards
            .values()
            .filter(|w| w.retired_at.is_none() && facility_id.is_none_or(|f| w.facility_id == f))
            .cloned()
            .collect();
        list.sort_by_key(|w| w.name.to_lowercase());
        Ok(list)
    }

    async fn get_ward(&self, id: &str) -> RepositoryResult<Option<WardEntity>> {
        Ok(self.wards.read().map_err(lock_error)?.get(id).cloned())
    }

    async fn assign_shift(
        &self,
        shift: ShiftAssignmentEntity,
    ) -> RepositoryResult<ShiftAssignmentEntity> {
        if !shift.is_valid() {
            return Err(RepositoryError::Validation(format!(
                "a shift ends after it starts and lasts at most {MAX_SHIFT_HOURS} hours"
            )));
        }
        if !self
            .wards
            .read()
            .map_err(lock_error)?
            .contains_key(&shift.ward_id)
        {
            return Err(RepositoryError::NotFound(format!("ward {}", shift.ward_id)));
        }
        self.shifts
            .write()
            .map_err(lock_error)?
            .insert(shift.id.clone(), shift.clone());
        Ok(shift)
    }

    async fn get_shift(&self, id: &str) -> RepositoryResult<Option<ShiftAssignmentEntity>> {
        Ok(self.shifts.read().map_err(lock_error)?.get(id).cloned())
    }

    async fn cancel_shift(
        &self,
        id: &str,
        by: &str,
        at: DateTime<Utc>,
    ) -> RepositoryResult<Option<ShiftAssignmentEntity>> {
        let mut shifts = self.shifts.write().map_err(lock_error)?;
        let Some(shift) = shifts.get_mut(id).filter(|s| s.cancelled_at.is_none()) else {
            return Ok(None);
        };
        shift.cancelled_at = Some(at);
        shift.cancelled_by = Some(by.to_string());
        Ok(Some(shift.clone()))
    }

    async fn shifts_on_ward(
        &self,
        ward_id: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> RepositoryResult<Vec<ShiftAssignmentEntity>> {
        let shifts = self.shifts.read().map_err(lock_error)?;
        let mut list: Vec<ShiftAssignmentEntity> = shifts
            .values()
            .filter(|s| s.ward_id == ward_id && s.starts_at < to && s.ends_at > from)
            .cloned()
            .collect();
        list.sort_by_key(|s| s.starts_at);
        Ok(list)
    }

    async fn current_shifts_of(
        &self,
        clinician_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Vec<ShiftAssignmentEntity>> {
        let shifts = self.shifts.read().map_err(lock_error)?;
        Ok(shifts
            .values()
            .filter(|s| s.clinician_id == clinician_id && s.is_on(now))
            .cloned()
            .collect())
    }

    async fn admit(&self, admission: AdmissionEntity) -> RepositoryResult<AdmissionEntity> {
        if !self
            .wards
            .read()
            .map_err(lock_error)?
            .contains_key(&admission.ward_id)
        {
            return Err(RepositoryError::NotFound(format!(
                "ward {}",
                admission.ward_id
            )));
        }
        let mut admissions = self.admissions.write().map_err(lock_error)?;
        if admissions
            .values()
            .any(|a| a.patient_id == admission.patient_id && a.discharged_at.is_none())
        {
            return Err(RepositoryError::Duplicate(
                "the patient is already admitted".into(),
            ));
        }
        admissions.insert(admission.id.clone(), admission.clone());
        Ok(admission)
    }

    async fn get_admission(&self, id: &str) -> RepositoryResult<Option<AdmissionEntity>> {
        Ok(self.admissions.read().map_err(lock_error)?.get(id).cloned())
    }

    async fn discharge(
        &self,
        id: &str,
        by: &str,
        at: DateTime<Utc>,
    ) -> RepositoryResult<Option<AdmissionEntity>> {
        let mut admissions = self.admissions.write().map_err(lock_error)?;
        let Some(admission) = admissions.get_mut(id).filter(|a| a.discharged_at.is_none()) else {
            return Ok(None);
        };
        admission.discharged_at = Some(at.max(admission.admitted_at));
        admission.discharged_by = Some(by.to_string());
        Ok(Some(admission.clone()))
    }

    async fn admissions_of_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AdmissionEntity>> {
        let admissions = self.admissions.read().map_err(lock_error)?;
        let mut list: Vec<AdmissionEntity> = admissions
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        list.sort_by_key(|a| std::cmp::Reverse(a.admitted_at));
        Ok(list)
    }

    async fn open_admissions_on(
        &self,
        ward_ids: &[String],
    ) -> RepositoryResult<Vec<AdmissionEntity>> {
        let admissions = self.admissions.read().map_err(lock_error)?;
        let mut list: Vec<AdmissionEntity> = admissions
            .values()
            .filter(|a| a.discharged_at.is_none() && ward_ids.contains(&a.ward_id))
            .cloned()
            .collect();
        list.sort_by(|a, b| a.bed_label.cmp(&b.bed_label));
        Ok(list)
    }

    async fn ward_authority(
        &self,
        patient_id: &str,
        clinician_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<WardAuthority>> {
        let admissions = self.admissions.read().map_err(lock_error)?;
        let Some(admission) = admissions
            .values()
            .find(|a| a.patient_id == patient_id && a.discharged_at.is_none())
        else {
            return Ok(None);
        };
        let shifts = self.shifts.read().map_err(lock_error)?;
        Ok(shifts
            .values()
            .find(|s| {
                s.ward_id == admission.ward_id && s.clinician_id == clinician_id && s.is_on(now)
            })
            .map(|s| WardAuthority {
                admission_id: admission.id.clone(),
                assignment_id: s.id.clone(),
            }))
    }
}

#[cfg(feature = "postgres")]
pub use pg::PgWardRepository;

#[cfg(feature = "postgres")]
pub(crate) mod pg {
    //! PostgreSQL rows. Every value is bound.

    use super::*;
    use sqlx::PgPool;

    const WARD_COLUMNS: &str = "id, facility_id, name, kind, created_by, created_at, retired_at";
    const SHIFT_COLUMNS: &str =
        "id, ward_id, clinician_id, starts_at, ends_at, assigned_by, created_at, cancelled_at, cancelled_by";
    const ADMISSION_COLUMNS: &str =
        "id, patient_id, ward_id, bed_label, admitted_at, admitted_by, discharged_at, discharged_by";

    #[derive(Debug, Clone)]
    pub struct PgWardRepository {
        pool: PgPool,
    }

    impl PgWardRepository {
        pub fn new(pool: PgPool) -> Self {
            Self { pool }
        }
    }

    #[async_trait]
    impl WardRepository for PgWardRepository {
        async fn create_ward(&self, ward: WardEntity) -> RepositoryResult<WardEntity> {
            let sql = format!(
                "INSERT INTO wards ({WARD_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {WARD_COLUMNS}"
            );
            Ok(sqlx::query_as::<_, WardEntity>(&sql)
                .bind(&ward.id)
                .bind(&ward.facility_id)
                .bind(&ward.name)
                .bind(&ward.kind)
                .bind(&ward.created_by)
                .bind(ward.created_at)
                .bind(ward.retired_at)
                .fetch_one(&self.pool)
                .await?)
        }

        async fn list_wards(&self, facility_id: Option<&str>) -> RepositoryResult<Vec<WardEntity>> {
            let sql = format!(
                "SELECT {WARD_COLUMNS} FROM wards
                 WHERE retired_at IS NULL AND ($1::text IS NULL OR facility_id = $1)
                 ORDER BY lower(name)"
            );
            Ok(sqlx::query_as::<_, WardEntity>(&sql)
                .bind(facility_id)
                .fetch_all(&self.pool)
                .await?)
        }

        async fn get_ward(&self, id: &str) -> RepositoryResult<Option<WardEntity>> {
            let sql = format!("SELECT {WARD_COLUMNS} FROM wards WHERE id = $1");
            Ok(sqlx::query_as::<_, WardEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn assign_shift(
            &self,
            shift: ShiftAssignmentEntity,
        ) -> RepositoryResult<ShiftAssignmentEntity> {
            let sql = format!(
                "INSERT INTO ward_shift_assignments ({SHIFT_COLUMNS})
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING {SHIFT_COLUMNS}"
            );
            Ok(sqlx::query_as::<_, ShiftAssignmentEntity>(&sql)
                .bind(&shift.id)
                .bind(&shift.ward_id)
                .bind(&shift.clinician_id)
                .bind(shift.starts_at)
                .bind(shift.ends_at)
                .bind(&shift.assigned_by)
                .bind(shift.created_at)
                .bind(shift.cancelled_at)
                .bind(&shift.cancelled_by)
                .fetch_one(&self.pool)
                .await?)
        }

        async fn get_shift(&self, id: &str) -> RepositoryResult<Option<ShiftAssignmentEntity>> {
            let sql = format!("SELECT {SHIFT_COLUMNS} FROM ward_shift_assignments WHERE id = $1");
            Ok(sqlx::query_as::<_, ShiftAssignmentEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn cancel_shift(
            &self,
            id: &str,
            by: &str,
            at: DateTime<Utc>,
        ) -> RepositoryResult<Option<ShiftAssignmentEntity>> {
            let sql = format!(
                "UPDATE ward_shift_assignments SET cancelled_at = $2, cancelled_by = $3
                 WHERE id = $1 AND cancelled_at IS NULL RETURNING {SHIFT_COLUMNS}"
            );
            Ok(sqlx::query_as::<_, ShiftAssignmentEntity>(&sql)
                .bind(id)
                .bind(at)
                .bind(by)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn shifts_on_ward(
            &self,
            ward_id: &str,
            from: DateTime<Utc>,
            to: DateTime<Utc>,
        ) -> RepositoryResult<Vec<ShiftAssignmentEntity>> {
            let sql = format!(
                "SELECT {SHIFT_COLUMNS} FROM ward_shift_assignments
                 WHERE ward_id = $1 AND starts_at < $3 AND ends_at > $2 ORDER BY starts_at"
            );
            Ok(sqlx::query_as::<_, ShiftAssignmentEntity>(&sql)
                .bind(ward_id)
                .bind(from)
                .bind(to)
                .fetch_all(&self.pool)
                .await?)
        }

        async fn current_shifts_of(
            &self,
            clinician_id: &str,
            now: DateTime<Utc>,
        ) -> RepositoryResult<Vec<ShiftAssignmentEntity>> {
            let sql = format!(
                "SELECT {SHIFT_COLUMNS} FROM ward_shift_assignments
                 WHERE clinician_id = $1 AND cancelled_at IS NULL AND starts_at <= $2 AND ends_at > $2"
            );
            Ok(sqlx::query_as::<_, ShiftAssignmentEntity>(&sql)
                .bind(clinician_id)
                .bind(now)
                .fetch_all(&self.pool)
                .await?)
        }

        async fn admit(&self, admission: AdmissionEntity) -> RepositoryResult<AdmissionEntity> {
            let sql = format!(
                "INSERT INTO patient_admissions ({ADMISSION_COLUMNS})
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {ADMISSION_COLUMNS}"
            );
            Ok(sqlx::query_as::<_, AdmissionEntity>(&sql)
                .bind(&admission.id)
                .bind(&admission.patient_id)
                .bind(&admission.ward_id)
                .bind(&admission.bed_label)
                .bind(admission.admitted_at)
                .bind(&admission.admitted_by)
                .bind(admission.discharged_at)
                .bind(&admission.discharged_by)
                .fetch_one(&self.pool)
                .await?)
        }

        async fn get_admission(&self, id: &str) -> RepositoryResult<Option<AdmissionEntity>> {
            let sql = format!("SELECT {ADMISSION_COLUMNS} FROM patient_admissions WHERE id = $1");
            Ok(sqlx::query_as::<_, AdmissionEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn discharge(
            &self,
            id: &str,
            by: &str,
            at: DateTime<Utc>,
        ) -> RepositoryResult<Option<AdmissionEntity>> {
            let sql = format!(
                "UPDATE patient_admissions SET discharged_at = GREATEST($2, admitted_at), discharged_by = $3
                 WHERE id = $1 AND discharged_at IS NULL RETURNING {ADMISSION_COLUMNS}"
            );
            Ok(sqlx::query_as::<_, AdmissionEntity>(&sql)
                .bind(id)
                .bind(at)
                .bind(by)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn admissions_of_patient(
            &self,
            patient_id: &str,
        ) -> RepositoryResult<Vec<AdmissionEntity>> {
            let sql = format!(
                "SELECT {ADMISSION_COLUMNS} FROM patient_admissions WHERE patient_id = $1 ORDER BY admitted_at DESC"
            );
            Ok(sqlx::query_as::<_, AdmissionEntity>(&sql)
                .bind(patient_id)
                .fetch_all(&self.pool)
                .await?)
        }

        async fn open_admissions_on(
            &self,
            ward_ids: &[String],
        ) -> RepositoryResult<Vec<AdmissionEntity>> {
            let sql = format!(
                "SELECT {ADMISSION_COLUMNS} FROM patient_admissions
                 WHERE discharged_at IS NULL AND ward_id = ANY($1) ORDER BY bed_label NULLS LAST"
            );
            Ok(sqlx::query_as::<_, AdmissionEntity>(&sql)
                .bind(ward_ids)
                .fetch_all(&self.pool)
                .await?)
        }

        async fn ward_authority(
            &self,
            patient_id: &str,
            clinician_id: &str,
            now: DateTime<Utc>,
        ) -> RepositoryResult<Option<WardAuthority>> {
            let row: Option<(String, String)> = sqlx::query_as(
                "SELECT a.id, s.id FROM patient_admissions a
                 JOIN ward_shift_assignments s ON s.ward_id = a.ward_id
                 WHERE a.patient_id = $1 AND a.discharged_at IS NULL
                   AND s.clinician_id = $2 AND s.cancelled_at IS NULL
                   AND s.starts_at <= $3 AND s.ends_at > $3
                 LIMIT 1",
            )
            .bind(patient_id)
            .bind(clinician_id)
            .bind(now)
            .fetch_optional(&self.pool)
            .await?;
            Ok(row.map(|(admission_id, assignment_id)| WardAuthority {
                admission_id,
                assignment_id,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ward(id: &str) -> WardEntity {
        WardEntity {
            id: id.into(),
            facility_id: "fac-1".into(),
            name: format!("Ward {id}"),
            kind: "general".into(),
            created_by: "admin".into(),
            created_at: Utc::now(),
            retired_at: None,
        }
    }

    fn shift(
        id: &str,
        ward: &str,
        who: &str,
        from: DateTime<Utc>,
        hours: i64,
    ) -> ShiftAssignmentEntity {
        ShiftAssignmentEntity {
            id: id.into(),
            ward_id: ward.into(),
            clinician_id: who.into(),
            starts_at: from,
            ends_at: from + Duration::hours(hours),
            assigned_by: "admin".into(),
            created_at: from,
            cancelled_at: None,
            cancelled_by: None,
        }
    }

    fn admission(id: &str, patient: &str, ward: &str) -> AdmissionEntity {
        AdmissionEntity {
            id: id.into(),
            patient_id: patient.into(),
            ward_id: ward.into(),
            bed_label: Some("B4".into()),
            admitted_at: Utc::now() - Duration::hours(2),
            admitted_by: "doc".into(),
            discharged_at: None,
            discharged_by: None,
        }
    }

    #[tokio::test]
    async fn authority_needs_an_open_admission_and_a_shift_on_that_ward_now() {
        let repo = MemoryWardRepository::new();
        let now = Utc::now();
        repo.create_ward(ward("W1")).await.unwrap();
        repo.create_ward(ward("W2")).await.unwrap();
        repo.admit(admission("A1", "P1", "W1")).await.unwrap();
        repo.assign_shift(shift("S-on", "W1", "nurse", now - Duration::hours(1), 8))
            .await
            .unwrap();
        repo.assign_shift(shift("S-off", "W1", "late", now + Duration::hours(1), 8))
            .await
            .unwrap();
        repo.assign_shift(shift(
            "S-other",
            "W2",
            "elsewhere",
            now - Duration::hours(1),
            8,
        ))
        .await
        .unwrap();

        assert_eq!(
            repo.ward_authority("P1", "nurse", now).await.unwrap(),
            Some(WardAuthority {
                admission_id: "A1".into(),
                assignment_id: "S-on".into()
            })
        );
        assert_eq!(
            repo.ward_authority("P1", "late", now).await.unwrap(),
            None,
            "off shift"
        );
        assert_eq!(
            repo.ward_authority("P1", "elsewhere", now).await.unwrap(),
            None,
            "other ward"
        );

        repo.discharge("A1", "doc", now).await.unwrap();
        assert_eq!(
            repo.ward_authority("P1", "nurse", now).await.unwrap(),
            None,
            "discharged"
        );
    }

    #[tokio::test]
    async fn a_cancelled_shift_grants_nothing() {
        let repo = MemoryWardRepository::new();
        let now = Utc::now();
        repo.create_ward(ward("W1")).await.unwrap();
        repo.admit(admission("A1", "P1", "W1")).await.unwrap();
        repo.assign_shift(shift("S1", "W1", "nurse", now - Duration::hours(1), 8))
            .await
            .unwrap();
        assert!(repo
            .cancel_shift("S1", "admin", now)
            .await
            .unwrap()
            .is_some());
        assert!(
            repo.cancel_shift("S1", "admin", now)
                .await
                .unwrap()
                .is_none(),
            "already cancelled"
        );
        assert_eq!(repo.ward_authority("P1", "nurse", now).await.unwrap(), None);
    }

    #[tokio::test]
    async fn the_tables_rules_hold_in_memory_too() {
        let repo = MemoryWardRepository::new();
        let now = Utc::now();
        repo.create_ward(ward("W1")).await.unwrap();
        assert!(matches!(
            repo.create_ward(WardEntity {
                id: "W9".into(),
                ..ward("W1")
            })
            .await,
            Err(RepositoryError::Duplicate(_))
        ));
        assert!(matches!(
            repo.assign_shift(shift("S", "W1", "n", now, 25)).await,
            Err(RepositoryError::Validation(_))
        ));
        repo.admit(admission("A1", "P1", "W1")).await.unwrap();
        assert!(matches!(
            repo.admit(admission("A2", "P1", "W1")).await,
            Err(RepositoryError::Duplicate(_))
        ));
        assert!(matches!(
            repo.admit(admission("A3", "P2", "nope")).await,
            Err(RepositoryError::NotFound(_))
        ));
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;

    /// The ward rules hold in PostgreSQL, and the authority query finds the
    /// rostered nurse and nobody else.
    #[tokio::test]
    async fn test_pg_ward_authority_and_rules() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let repo = PgWardRepository::new(pool.clone());
        let tag = uuid::Uuid::new_v4().simple().to_string();
        let patient = format!("PAT-WARD-{}", &tag[..8]);
        sqlx::query(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type)
             VALUES ($1, $1, 'test-hash', 'SmartID') ON CONFLICT (id) DO NOTHING",
        )
        .bind(&patient)
        .execute(&pool)
        .await
        .unwrap();
        let now = Utc::now();
        let ward_id = format!("WARD-{tag}");
        let ward = WardEntity {
            id: ward_id.clone(),
            facility_id: format!("fac-{tag}"),
            name: "Ward 4".into(),
            kind: "general".into(),
            created_by: "admin".into(),
            created_at: now,
            retired_at: None,
        };
        repo.create_ward(ward.clone()).await.unwrap();
        assert!(matches!(
            repo.create_ward(WardEntity {
                id: format!("WARD-2-{tag}"),
                name: "WARD 4".into(),
                ..ward
            })
            .await,
            Err(RepositoryError::Duplicate(_))
        ));

        let shift = |id: &str, who: &str, from: DateTime<Utc>, hours: i64| ShiftAssignmentEntity {
            id: format!("{id}-{tag}"),
            ward_id: ward_id.clone(),
            clinician_id: who.into(),
            starts_at: from,
            ends_at: from + Duration::hours(hours),
            assigned_by: "admin".into(),
            created_at: now,
            cancelled_at: None,
            cancelled_by: None,
        };
        repo.assign_shift(shift("S-on", "nurse-on", now - Duration::hours(1), 8))
            .await
            .unwrap();
        repo.assign_shift(shift("S-late", "nurse-late", now + Duration::hours(2), 8))
            .await
            .unwrap();
        assert!(
            repo.assign_shift(shift("S-long", "nurse-x", now, 30))
                .await
                .is_err(),
            "the 24-hour CHECK"
        );

        let admission = AdmissionEntity {
            id: format!("ADM-{tag}"),
            patient_id: patient.clone(),
            ward_id: ward_id.clone(),
            bed_label: Some("B4".into()),
            admitted_at: now - Duration::minutes(30),
            admitted_by: "doc".into(),
            discharged_at: None,
            discharged_by: None,
        };
        repo.admit(admission.clone()).await.unwrap();
        assert!(
            matches!(
                repo.admit(AdmissionEntity {
                    id: format!("ADM-2-{tag}"),
                    ..admission.clone()
                })
                .await,
                Err(RepositoryError::Duplicate(_))
            ),
            "one open admission per patient"
        );

        let found = repo
            .ward_authority(&patient, "nurse-on", now)
            .await
            .unwrap();
        assert_eq!(found.map(|a| a.admission_id), Some(admission.id.clone()));
        assert!(repo
            .ward_authority(&patient, "nurse-late", now)
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            repo.open_admissions_on(std::slice::from_ref(&ward_id))
                .await
                .unwrap()
                .len(),
            1
        );

        assert!(repo
            .discharge(&admission.id, "doc", now)
            .await
            .unwrap()
            .is_some());
        assert!(repo
            .discharge(&admission.id, "doc", now)
            .await
            .unwrap()
            .is_none());
        assert!(repo
            .ward_authority(&patient, "nurse-on", now)
            .await
            .unwrap()
            .is_none());

        // The audit row and the access context can now name the authority.
        for constraint in [
            "access_logs_authority_type_check",
            "access_contexts_authority_type_check",
        ] {
            let (definition,): (String,) =
                sqlx::query_as("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = $1 AND connamespace = current_schema()::regnamespace")
                    .bind(constraint)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert!(
                definition.contains("ward_assignment"),
                "{constraint}: {definition}"
            );
        }
    }
}
