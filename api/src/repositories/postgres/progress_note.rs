//! PostgreSQL implementation of ProgressNoteRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    PaginatedResult, Pagination, ProgressNoteEntity, ProgressNoteRepository, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgProgressNoteRepository {
    pool: PgPool,
}

impl PgProgressNoteRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ProgressNoteRepository for PgProgressNoteRepository {
    async fn create(&self, note: ProgressNoteEntity) -> RepositoryResult<ProgressNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO progress_notes (id, patient_id, note_type, subjective, objective, assessment, plan_content, addendum, cosigned_by, cosigned_at, visit_type, encounter_id, created_by, status, facility_id) "
        );

        qb.push_values([&note], |mut b, n| {
            b.push_bind(&n.id)
                .push_bind(&n.patient_id)
                .push_bind(&n.note_type)
                .push_bind(&n.subjective)
                .push_bind(&n.objective)
                .push_bind(&n.assessment)
                .push_bind(&n.plan_content)
                .push_bind(&n.addendum)
                .push_bind(&n.cosigned_by)
                .push_bind(n.cosigned_at)
                .push_bind(&n.visit_type)
                .push_bind(&n.encounter_id)
                .push_bind(&n.created_by)
                .push_bind(&n.status)
                .push_bind(&n.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ProgressNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ProgressNoteEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM progress_notes WHERE id = ");
        qb.push_bind(id);

        let note = qb
            .build_query_as::<ProgressNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(note)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>> {
        let offset = pagination.offset() as i64;
        let limit = pagination.limit() as i64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM progress_notes WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY created_at DESC LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);

        let notes = qb
            .build_query_as::<ProgressNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM progress_notes WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        Ok(PaginatedResult::new(notes, total as u64, &pagination))
    }

    async fn get_by_encounter(
        &self,
        encounter_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>> {
        let offset = pagination.offset() as i64;
        let limit = pagination.limit() as i64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM progress_notes WHERE encounter_id = ");
        qb.push_bind(encounter_id);
        qb.push(" AND is_active = true ORDER BY created_at DESC LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);

        let notes = qb
            .build_query_as::<ProgressNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM progress_notes WHERE encounter_id = ");
        count_qb.push_bind(encounter_id);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        Ok(PaginatedResult::new(notes, total as u64, &pagination))
    }

    async fn update(&self, note: ProgressNoteEntity) -> RepositoryResult<ProgressNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE progress_notes SET ");
        qb.push("note_type = ").push_bind(&note.note_type);
        qb.push(", subjective = ").push_bind(&note.subjective);
        qb.push(", objective = ").push_bind(&note.objective);
        qb.push(", assessment = ").push_bind(&note.assessment);
        qb.push(", plan_content = ").push_bind(&note.plan_content);
        qb.push(", addendum = ").push_bind(&note.addendum);
        qb.push(", cosigned_by = ").push_bind(&note.cosigned_by);
        qb.push(", cosigned_at = ").push_bind(note.cosigned_at);
        qb.push(", visit_type = ").push_bind(&note.visit_type);
        qb.push(", encounter_id = ").push_bind(&note.encounter_id);
        qb.push(", status = ").push_bind(&note.status);
        qb.push(", facility_id = ").push_bind(&note.facility_id);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&note.id);
        qb.push(" RETURNING *");

        let updated = qb
            .build_query_as::<ProgressNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(updated)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE progress_notes SET is_active = false WHERE id = ");
        qb.push_bind(id);

        qb.build().execute(&self.pool).await?;

        Ok(())
    }

    async fn search_by_type(
        &self,
        note_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>> {
        let offset = pagination.offset() as i64;
        let limit = pagination.limit() as i64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM progress_notes WHERE note_type = ");
        qb.push_bind(note_type);
        qb.push(" AND is_active = true ORDER BY created_at DESC LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);

        let notes = qb
            .build_query_as::<ProgressNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM progress_notes WHERE note_type = ");
        count_qb.push_bind(note_type);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        Ok(PaginatedResult::new(notes, total as u64, &pagination))
    }
}
