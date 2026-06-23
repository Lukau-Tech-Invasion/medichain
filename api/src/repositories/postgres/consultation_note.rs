//! PostgreSQL implementation of ConsultationNoteRepository.
//! Uses sqlx::QueryBuilder pattern for type-safe query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    ConsultationNoteEntity, ConsultationNoteRepository, PaginatedResult, Pagination,
    RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgConsultationNoteRepository {
    pool: PgPool,
}

impl PgConsultationNoteRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ConsultationNoteRepository for PgConsultationNoteRepository {
    async fn create(
        &self,
        note: ConsultationNoteEntity,
    ) -> RepositoryResult<ConsultationNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO consultation_notes (
                id, patient_id, consultation_type, requesting_provider, consulting_provider,
                reason_for_consultation, clinical_question, pertinent_history, examination_findings,
                recommendations, follow_up_plan, urgency, status, requested_at, completed_at, facility_id, data
            ) "
        );

        qb.push_values([&note], |mut b, n| {
            b.push_bind(&n.id)
                .push_bind(&n.patient_id)
                .push_bind(&n.consultation_type)
                .push_bind(&n.requesting_provider)
                .push_bind(&n.consulting_provider)
                .push_bind(&n.reason_for_consultation)
                .push_bind(&n.clinical_question)
                .push_bind(&n.pertinent_history)
                .push_bind(&n.examination_findings)
                .push_bind(&n.recommendations)
                .push_bind(&n.follow_up_plan)
                .push_bind(&n.urgency)
                .push_bind(&n.status)
                .push_bind(n.requested_at)
                .push_bind(n.completed_at)
                .push_bind(&n.facility_id)
                .push_bind(&n.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ConsultationNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsultationNoteEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consultation_notes WHERE id = ");
        qb.push_bind(id);
        qb.push(" AND is_active = true");

        let note = qb
            .build_query_as::<ConsultationNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(note)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM consultation_notes WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true");
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consultation_notes WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY requested_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let notes = qb
            .build_query_as::<ConsultationNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(notes, total as u64, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>> {
        let mut count_qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FROM consultation_notes WHERE consulting_provider = ",
        );
        count_qb.push_bind(provider_id);
        count_qb.push(" AND is_active = true");
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consultation_notes WHERE consulting_provider = ");
        qb.push_bind(provider_id);
        qb.push(" AND is_active = true ORDER BY requested_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let notes = qb
            .build_query_as::<ConsultationNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(notes, total as u64, &pagination))
    }

    async fn update(
        &self,
        note: ConsultationNoteEntity,
    ) -> RepositoryResult<ConsultationNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE consultation_notes SET ");
        qb.push("consultation_type = ")
            .push_bind(&note.consultation_type);
        qb.push(", requesting_provider = ")
            .push_bind(&note.requesting_provider);
        qb.push(", consulting_provider = ")
            .push_bind(&note.consulting_provider);
        qb.push(", reason_for_consultation = ")
            .push_bind(&note.reason_for_consultation);
        qb.push(", clinical_question = ")
            .push_bind(&note.clinical_question);
        qb.push(", pertinent_history = ")
            .push_bind(&note.pertinent_history);
        qb.push(", examination_findings = ")
            .push_bind(&note.examination_findings);
        qb.push(", recommendations = ")
            .push_bind(&note.recommendations);
        qb.push(", follow_up_plan = ")
            .push_bind(&note.follow_up_plan);
        qb.push(", urgency = ").push_bind(&note.urgency);
        qb.push(", status = ").push_bind(&note.status);
        qb.push(", completed_at = ").push_bind(note.completed_at);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&note.id);
        qb.push(" AND is_active = true RETURNING *");

        let result = qb
            .build_query_as::<ConsultationNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_status(
        &self,
        status: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM consultation_notes WHERE status = ");
        count_qb.push_bind(status);
        count_qb.push(" AND is_active = true");
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consultation_notes WHERE status = ");
        qb.push_bind(status);
        qb.push(" AND is_active = true ORDER BY requested_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let notes = qb
            .build_query_as::<ConsultationNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(notes, total as u64, &pagination))
    }
}
