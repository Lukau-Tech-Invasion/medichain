//! PostgreSQL implementations for Phase 8 Telehealth repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use chrono::Utc;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// TELEHEALTH SESSION REPOSITORY
// =============================================================================

/// PostgreSQL-backed telehealth session repository
#[derive(Debug, Clone)]
pub struct PgTelehealthSessionRepository {
    pool: PgPool,
}

impl PgTelehealthSessionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TelehealthSessionRepository for PgTelehealthSessionRepository {
    async fn create(
        &self,
        session: TelehealthSessionEntity,
    ) -> RepositoryResult<TelehealthSessionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO telehealth_sessions (
                id, patient_id, provider_id, appointment_id, session_type,
                scheduled_datetime, actual_start_datetime, actual_end_datetime,
                duration_minutes, status, platform, session_url, session_access_code,
                patient_location, patient_device_type, provider_location,
                connection_quality, technical_issues, interpreter_required,
                interpreter_language, interpreter_present, guardian_present,
                guardian_name, consent_obtained, consent_datetime, billing_code,
                reason_for_visit, chief_complaint, follow_up_required, follow_up_notes,
                recording_available, recording_url, created_by
            ) ",
        );

        qb.push_values([&session], |mut b, s| {
            b.push_bind(&s.id)
                .push_bind(&s.patient_id)
                .push_bind(&s.provider_id)
                .push_bind(&s.appointment_id)
                .push_bind(&s.session_type)
                .push_bind(s.scheduled_datetime)
                .push_bind(s.actual_start_datetime)
                .push_bind(s.actual_end_datetime)
                .push_bind(s.duration_minutes)
                .push_bind(&s.status)
                .push_bind(&s.platform)
                .push_bind(&s.session_url)
                .push_bind(&s.session_access_code)
                .push_bind(&s.patient_location)
                .push_bind(&s.patient_device_type)
                .push_bind(&s.provider_location)
                .push_bind(&s.connection_quality)
                .push_bind(&s.technical_issues)
                .push_bind(s.interpreter_required)
                .push_bind(&s.interpreter_language)
                .push_bind(s.interpreter_present)
                .push_bind(s.guardian_present)
                .push_bind(&s.guardian_name)
                .push_bind(s.consent_obtained)
                .push_bind(s.consent_datetime)
                .push_bind(&s.billing_code)
                .push_bind(&s.reason_for_visit)
                .push_bind(&s.chief_complaint)
                .push_bind(s.follow_up_required)
                .push_bind(&s.follow_up_notes)
                .push_bind(s.recording_available)
                .push_bind(&s.recording_url)
                .push_bind(&s.created_by);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TelehealthSessionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM telehealth_sessions WHERE id = ");
        qb.push_bind(id);

        let session = qb
            .build_query_as::<TelehealthSessionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(session)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TelehealthSessionEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM telehealth_sessions WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM telehealth_sessions WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY scheduled_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<TelehealthSessionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<TelehealthSessionEntity>> {
        let start = date.and_hms_opt(0, 0, 0).unwrap();
        let end = date.and_hms_opt(23, 59, 59).unwrap();

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM telehealth_sessions WHERE provider_id = ");
        qb.push_bind(provider_id);
        qb.push(" AND scheduled_datetime >= ");
        qb.push_bind(start);
        qb.push(" AND scheduled_datetime <= ");
        qb.push_bind(end);
        qb.push(" ORDER BY scheduled_datetime ASC");

        let items = qb
            .build_query_as::<TelehealthSessionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        session: TelehealthSessionEntity,
    ) -> RepositoryResult<TelehealthSessionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE telehealth_sessions SET ");
        qb.push("status = ").push_bind(&session.status);
        qb.push(", actual_start_datetime = ")
            .push_bind(session.actual_start_datetime);
        qb.push(", actual_end_datetime = ")
            .push_bind(session.actual_end_datetime);
        qb.push(", duration_minutes = ")
            .push_bind(session.duration_minutes);
        qb.push(", connection_quality = ")
            .push_bind(&session.connection_quality);
        qb.push(", technical_issues = ")
            .push_bind(&session.technical_issues);
        qb.push(", follow_up_required = ")
            .push_bind(session.follow_up_required);
        qb.push(", follow_up_notes = ")
            .push_bind(&session.follow_up_notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&session.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TelehealthSessionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_upcoming(
        &self,
        provider_id: &str,
    ) -> RepositoryResult<Vec<TelehealthSessionEntity>> {
        let now = Utc::now();

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM telehealth_sessions WHERE provider_id = ");
        qb.push_bind(provider_id);
        qb.push(" AND status = 'scheduled' AND scheduled_datetime > ");
        qb.push_bind(now);
        qb.push(" ORDER BY scheduled_datetime ASC");

        let items = qb
            .build_query_as::<TelehealthSessionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn start_session(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE telehealth_sessions SET ");
        qb.push(
            "status = 'in_progress', actual_start_datetime = NOW(), updated_at = NOW() WHERE id = ",
        )
        .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TelehealthSessionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn end_session(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity> {
        // Calculate duration based on start time
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE telehealth_sessions SET 
             status = 'completed', 
             actual_end_datetime = NOW(),
             duration_minutes = EXTRACT(EPOCH FROM (NOW() - actual_start_datetime))::INT / 60,
             updated_at = NOW() 
             WHERE id = ",
        );
        qb.push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TelehealthSessionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// TELEHEALTH NOTE REPOSITORY
// =============================================================================

/// PostgreSQL-backed telehealth note repository
#[derive(Debug, Clone)]
pub struct PgTelehealthNoteRepository {
    pool: PgPool,
}

impl PgTelehealthNoteRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TelehealthNoteRepository for PgTelehealthNoteRepository {
    async fn create(&self, note: TelehealthNoteEntity) -> RepositoryResult<TelehealthNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO telehealth_notes (
                id, session_id, patient_id, provider_id, note_datetime,
                subjective, objective, assessment, plan, physical_exam_limitations,
                recommendations_for_inperson, prescriptions_issued, referrals_made,
                lab_orders, imaging_orders, patient_education_provided,
                patient_understanding_verified, follow_up_timeframe,
                provider_signature, signed_datetime, addendum, addendum_datetime
            ) ",
        );

        qb.push_values([&note], |mut b, n| {
            b.push_bind(&n.id)
                .push_bind(&n.session_id)
                .push_bind(&n.patient_id)
                .push_bind(&n.provider_id)
                .push_bind(n.note_datetime)
                .push_bind(&n.subjective)
                .push_bind(&n.objective)
                .push_bind(&n.assessment)
                .push_bind(&n.plan)
                .push_bind(&n.physical_exam_limitations)
                .push_bind(&n.recommendations_for_inperson)
                .push_bind(&n.prescriptions_issued)
                .push_bind(&n.referrals_made)
                .push_bind(&n.lab_orders)
                .push_bind(&n.imaging_orders)
                .push_bind(&n.patient_education_provided)
                .push_bind(n.patient_understanding_verified)
                .push_bind(&n.follow_up_timeframe)
                .push_bind(&n.provider_signature)
                .push_bind(n.signed_datetime)
                .push_bind(&n.addendum)
                .push_bind(n.addendum_datetime);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TelehealthNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TelehealthNoteEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM telehealth_notes WHERE id = ");
        qb.push_bind(id);

        let note = qb
            .build_query_as::<TelehealthNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(note)
    }

    async fn get_by_session(
        &self,
        session_id: &str,
    ) -> RepositoryResult<Option<TelehealthNoteEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM telehealth_notes WHERE session_id = ");
        qb.push_bind(session_id);

        let note = qb
            .build_query_as::<TelehealthNoteEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(note)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TelehealthNoteEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM telehealth_notes WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM telehealth_notes WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY note_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<TelehealthNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, note: TelehealthNoteEntity) -> RepositoryResult<TelehealthNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE telehealth_notes SET ");
        qb.push("subjective = ").push_bind(&note.subjective);
        qb.push(", objective = ").push_bind(&note.objective);
        qb.push(", assessment = ").push_bind(&note.assessment);
        qb.push(", plan = ").push_bind(&note.plan);
        qb.push(", physical_exam_limitations = ")
            .push_bind(&note.physical_exam_limitations);
        qb.push(", recommendations_for_inperson = ")
            .push_bind(&note.recommendations_for_inperson);
        qb.push(", prescriptions_issued = ")
            .push_bind(&note.prescriptions_issued);
        qb.push(", referrals_made = ")
            .push_bind(&note.referrals_made);
        qb.push(", lab_orders = ").push_bind(&note.lab_orders);
        qb.push(", imaging_orders = ")
            .push_bind(&note.imaging_orders);
        qb.push(", follow_up_timeframe = ")
            .push_bind(&note.follow_up_timeframe);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&note.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TelehealthNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn sign(
        &self,
        id: &str,
        provider_signature: &str,
    ) -> RepositoryResult<TelehealthNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE telehealth_notes SET ");
        qb.push("provider_signature = ")
            .push_bind(provider_signature);
        qb.push(", signed_datetime = NOW(), updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TelehealthNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn add_addendum(
        &self,
        id: &str,
        addendum: &str,
    ) -> RepositoryResult<TelehealthNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE telehealth_notes SET ");
        qb.push("addendum = ").push_bind(addendum);
        qb.push(", addendum_datetime = NOW(), updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TelehealthNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// REMOTE PATIENT MONITORING REPOSITORY
// =============================================================================

/// PostgreSQL-backed remote patient monitoring repository
#[derive(Debug, Clone)]
pub struct PgRemotePatientMonitoringRepository {
    pool: PgPool,
}

impl PgRemotePatientMonitoringRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RemotePatientMonitoringRepository for PgRemotePatientMonitoringRepository {
    async fn create(
        &self,
        enrollment: RemotePatientMonitoringEntity,
    ) -> RepositoryResult<RemotePatientMonitoringEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO remote_patient_monitoring (
                id, patient_id, program_name, enrollment_date, enrolled_by,
                primary_condition, secondary_conditions, monitoring_parameters,
                target_goals, alert_thresholds, monitoring_frequency,
                assigned_care_manager, care_team_members, devices_assigned,
                billing_eligible, insurance_authorization, authorization_expiry,
                status, status_reason, graduation_criteria, last_review_date,
                next_review_date, notes
            ) ",
        );

        qb.push_values([&enrollment], |mut b, e| {
            b.push_bind(&e.id)
                .push_bind(&e.patient_id)
                .push_bind(&e.program_name)
                .push_bind(e.enrollment_date)
                .push_bind(&e.enrolled_by)
                .push_bind(&e.primary_condition)
                .push_bind(&e.secondary_conditions)
                .push_bind(&e.monitoring_parameters)
                .push_bind(&e.target_goals)
                .push_bind(&e.alert_thresholds)
                .push_bind(&e.monitoring_frequency)
                .push_bind(&e.assigned_care_manager)
                .push_bind(&e.care_team_members)
                .push_bind(&e.devices_assigned)
                .push_bind(e.billing_eligible)
                .push_bind(&e.insurance_authorization)
                .push_bind(e.authorization_expiry)
                .push_bind(&e.status)
                .push_bind(&e.status_reason)
                .push_bind(&e.graduation_criteria)
                .push_bind(e.last_review_date)
                .push_bind(e.next_review_date)
                .push_bind(&e.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RemotePatientMonitoringEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RemotePatientMonitoringEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM remote_patient_monitoring WHERE id = ");
        qb.push_bind(id);

        let enrollment = qb
            .build_query_as::<RemotePatientMonitoringEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(enrollment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM remote_patient_monitoring WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY enrollment_date DESC");

        let items = qb
            .build_query_as::<RemotePatientMonitoringEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_active_by_program(
        &self,
        program_name: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM remote_patient_monitoring WHERE program_name = ");
        qb.push_bind(program_name);
        qb.push(" AND status = 'active' ORDER BY enrollment_date DESC");

        let items = qb
            .build_query_as::<RemotePatientMonitoringEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        enrollment: RemotePatientMonitoringEntity,
    ) -> RepositoryResult<RemotePatientMonitoringEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE remote_patient_monitoring SET ");
        qb.push("monitoring_parameters = ")
            .push_bind(&enrollment.monitoring_parameters);
        qb.push(", target_goals = ")
            .push_bind(&enrollment.target_goals);
        qb.push(", alert_thresholds = ")
            .push_bind(&enrollment.alert_thresholds);
        qb.push(", assigned_care_manager = ")
            .push_bind(&enrollment.assigned_care_manager);
        qb.push(", devices_assigned = ")
            .push_bind(&enrollment.devices_assigned);
        qb.push(", status = ").push_bind(&enrollment.status);
        qb.push(", last_review_date = ")
            .push_bind(enrollment.last_review_date);
        qb.push(", next_review_date = ")
            .push_bind(enrollment.next_review_date);
        qb.push(", notes = ").push_bind(&enrollment.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&enrollment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RemotePatientMonitoringEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn update_status(
        &self,
        id: &str,
        status: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<RemotePatientMonitoringEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE remote_patient_monitoring SET ");
        qb.push("status = ").push_bind(status);
        if let Some(r) = reason {
            qb.push(", status_reason = ").push_bind(r);
        }
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RemotePatientMonitoringEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_care_manager(
        &self,
        care_manager_id: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM remote_patient_monitoring WHERE assigned_care_manager = ",
        );
        qb.push_bind(care_manager_id);
        qb.push(" AND status = 'active' ORDER BY patient_id");

        let items = qb
            .build_query_as::<RemotePatientMonitoringEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// RPM READING REPOSITORY
// =============================================================================

/// PostgreSQL-backed RPM reading repository
#[derive(Debug, Clone)]
pub struct PgRpmReadingRepository {
    pool: PgPool,
}

impl PgRpmReadingRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RpmReadingRepository for PgRpmReadingRepository {
    async fn create(&self, reading: RpmReadingEntity) -> RepositoryResult<RpmReadingEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO rpm_readings (
                id, rpm_enrollment_id, patient_id, device_id, reading_datetime,
                reading_type, systolic, diastolic, value_numeric, unit_of_measure,
                measurement_context, symptoms_reported, patient_notes, is_within_target,
                deviation_type, deviation_severity, alert_triggered, alert_id,
                reviewed, reviewed_by, reviewed_datetime, review_notes, action_taken
            ) ",
        );

        qb.push_values([&reading], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.rpm_enrollment_id)
                .push_bind(&r.patient_id)
                .push_bind(&r.device_id)
                .push_bind(r.reading_datetime)
                .push_bind(&r.reading_type)
                .push_bind(r.systolic)
                .push_bind(r.diastolic)
                .push_bind(r.value_numeric)
                .push_bind(&r.unit_of_measure)
                .push_bind(&r.measurement_context)
                .push_bind(&r.symptoms_reported)
                .push_bind(&r.patient_notes)
                .push_bind(r.is_within_target)
                .push_bind(&r.deviation_type)
                .push_bind(&r.deviation_severity)
                .push_bind(r.alert_triggered)
                .push_bind(&r.alert_id)
                .push_bind(r.reviewed)
                .push_bind(&r.reviewed_by)
                .push_bind(r.reviewed_datetime)
                .push_bind(&r.review_notes)
                .push_bind(&r.action_taken);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RpmReadingEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RpmReadingEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM rpm_readings WHERE id = ");
        qb.push_bind(id);

        let reading = qb
            .build_query_as::<RpmReadingEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(reading)
    }

    async fn get_by_enrollment(
        &self,
        enrollment_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RpmReadingEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM rpm_readings WHERE rpm_enrollment_id = ");
        count_qb.push_bind(enrollment_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM rpm_readings WHERE rpm_enrollment_id = ");
        qb.push_bind(enrollment_id);
        qb.push(" ORDER BY reading_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<RpmReadingEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        reading_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RpmReadingEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM rpm_readings WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        if let Some(rt) = reading_type {
            count_qb.push(" AND reading_type = ");
            count_qb.push_bind(rt);
        }

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM rpm_readings WHERE patient_id = ");
        qb.push_bind(patient_id);
        if let Some(rt) = reading_type {
            qb.push(" AND reading_type = ");
            qb.push_bind(rt);
        }
        qb.push(" ORDER BY reading_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<RpmReadingEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_unreviewed(&self) -> RepositoryResult<Vec<RpmReadingEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM rpm_readings WHERE reviewed = false ORDER BY reading_datetime ASC",
        );

        let items = qb
            .build_query_as::<RpmReadingEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn review(
        &self,
        id: &str,
        reviewed_by: &str,
        notes: Option<&str>,
        action: Option<&str>,
    ) -> RepositoryResult<RpmReadingEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE rpm_readings SET ");
        qb.push("reviewed = true, reviewed_by = ")
            .push_bind(reviewed_by);
        qb.push(", reviewed_datetime = NOW()");
        if let Some(n) = notes {
            qb.push(", review_notes = ").push_bind(n);
        }
        if let Some(a) = action {
            qb.push(", action_taken = ").push_bind(a);
        }
        qb.push(" WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RpmReadingEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_alerts(&self, enrollment_id: &str) -> RepositoryResult<Vec<RpmReadingEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM rpm_readings WHERE rpm_enrollment_id = ");
        qb.push_bind(enrollment_id);
        qb.push(" AND alert_triggered = true ORDER BY reading_datetime DESC");

        let items = qb
            .build_query_as::<RpmReadingEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
