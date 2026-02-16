//! PostgreSQL implementation of VitalSignsRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::{
    DateRange, PaginatedResult, Pagination, RepositoryResult, VitalSignsEntity,
    VitalSignsRepository,
};

/// PostgreSQL-backed vital signs repository
#[derive(Debug, Clone)]
pub struct PgVitalSignsRepository {
    pool: PgPool,
}

impl PgVitalSignsRepository {
    /// Create a new PostgreSQL vital signs repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl VitalSignsRepository for PgVitalSignsRepository {
    async fn create(&self, vitals: VitalSignsEntity) -> RepositoryResult<VitalSignsEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO vital_signs (
                id, patient_id, heart_rate, respiratory_rate, blood_pressure_systolic,
                blood_pressure_diastolic, mean_arterial_pressure, temperature, temperature_site,
                oxygen_saturation, oxygen_delivery, fio2, pain_scale, gcs_score, gcs_eye,
                gcs_verbal, gcs_motor, blood_glucose, weight_kg, height_cm, bmi, position,
                activity_level, is_critical, critical_values, recorded_at, recorded_by, facility_id
            ) ",
        );

        qb.push_values([&vitals], |mut b, v| {
            b.push_bind(&v.id)
                .push_bind(&v.patient_id)
                .push_bind(v.heart_rate)
                .push_bind(v.respiratory_rate)
                .push_bind(v.blood_pressure_systolic)
                .push_bind(v.blood_pressure_diastolic)
                .push_bind(v.mean_arterial_pressure)
                .push_bind(v.temperature)
                .push_bind(&v.temperature_site)
                .push_bind(v.oxygen_saturation)
                .push_bind(&v.oxygen_delivery)
                .push_bind(v.fio2)
                .push_bind(v.pain_scale)
                .push_bind(v.gcs_score)
                .push_bind(v.gcs_eye)
                .push_bind(v.gcs_verbal)
                .push_bind(v.gcs_motor)
                .push_bind(v.blood_glucose)
                .push_bind(v.weight_kg)
                .push_bind(v.height_cm)
                .push_bind(v.bmi)
                .push_bind(&v.position)
                .push_bind(&v.activity_level)
                .push_bind(v.is_critical)
                .push_bind(&v.critical_values)
                .push_bind(v.recorded_at)
                .push_bind(&v.recorded_by)
                .push_bind(&v.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<VitalSignsEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<VitalSignsEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM vital_signs WHERE id = ");
        qb.push_bind(id);

        let vitals = qb
            .build_query_as::<VitalSignsEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(vitals)
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<VitalSignsEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM vital_signs WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY recorded_at DESC LIMIT 1");

        let vitals = qb
            .build_query_as::<VitalSignsEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(vitals)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<VitalSignsEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM vital_signs WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let count = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM vital_signs WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY recorded_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let vitals = qb
            .build_query_as::<VitalSignsEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(vitals, count as u64, &pagination))
    }

    async fn get_by_date_range(
        &self,
        patient_id: &str,
        range: DateRange,
    ) -> RepositoryResult<Vec<VitalSignsEntity>> {
        let from = range
            .from
            .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap());
        let to = range.to.unwrap_or_else(Utc::now);

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM vital_signs WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND recorded_at >= ");
        qb.push_bind(from);
        qb.push(" AND recorded_at <= ");
        qb.push_bind(to);
        qb.push(" ORDER BY recorded_at DESC LIMIT 1000");

        let vitals = qb
            .build_query_as::<VitalSignsEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(vitals)
    }

    async fn get_critical(&self) -> RepositoryResult<Vec<VitalSignsEntity>> {
        let cutoff = Utc::now() - Duration::hours(24);

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM vital_signs WHERE is_critical = true AND recorded_at >= ",
        );
        qb.push_bind(cutoff);
        qb.push(" ORDER BY recorded_at DESC LIMIT 100");

        let vitals = qb
            .build_query_as::<VitalSignsEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(vitals)
    }
}
