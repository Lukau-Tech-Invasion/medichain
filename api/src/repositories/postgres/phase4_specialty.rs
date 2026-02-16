//! PostgreSQL implementations for Phase 4 Specialty Assessments repositories.
//!
//! This module uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use rust_decimal::Decimal;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// BURN ASSESSMENT REPOSITORY
// =============================================================================

/// PostgreSQL-backed burn assessment repository
#[derive(Debug, Clone)]
pub struct PgBurnAssessmentRepository {
    pool: PgPool,
}

impl PgBurnAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl BurnAssessmentRepository for PgBurnAssessmentRepository {
    async fn create(
        &self,
        assessment: BurnAssessmentEntity,
    ) -> RepositoryResult<BurnAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO burn_assessments (
                id, patient_id, assessed_by, assessment_datetime, mechanism_of_injury,
                burn_agent, time_of_injury, tbsa_percentage, burn_depth, affected_areas,
                inhalation_injury, inhalation_symptoms, airway_status, circumferential_burns,
                circumferential_locations, escharotomy_needed, escharotomy_performed,
                fluid_resuscitation_started, parkland_formula_volume, urine_output_goal,
                pain_score, tetanus_status, transfer_to_burn_center, burn_center_notified,
                photos_taken, notes
            ) ",
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.assessed_by)
                .push_bind(a.assessment_datetime)
                .push_bind(&a.mechanism_of_injury)
                .push_bind(&a.burn_agent)
                .push_bind(a.time_of_injury)
                .push_bind(a.tbsa_percentage)
                .push_bind(&a.burn_depth)
                .push_bind(&a.affected_areas)
                .push_bind(a.inhalation_injury)
                .push_bind(&a.inhalation_symptoms)
                .push_bind(&a.airway_status)
                .push_bind(a.circumferential_burns)
                .push_bind(&a.circumferential_locations)
                .push_bind(a.escharotomy_needed)
                .push_bind(a.escharotomy_performed)
                .push_bind(a.fluid_resuscitation_started)
                .push_bind(a.parkland_formula_volume)
                .push_bind(a.urine_output_goal)
                .push_bind(a.pain_score)
                .push_bind(&a.tetanus_status)
                .push_bind(a.transfer_to_burn_center)
                .push_bind(a.burn_center_notified)
                .push_bind(a.photos_taken)
                .push_bind(&a.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<BurnAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<BurnAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM burn_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<BurnAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BurnAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM burn_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM burn_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessment_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<BurnAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        assessment: BurnAssessmentEntity,
    ) -> RepositoryResult<BurnAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE burn_assessments SET ");
        qb.push("mechanism_of_injury = ")
            .push_bind(&assessment.mechanism_of_injury);
        qb.push(", burn_agent = ").push_bind(&assessment.burn_agent);
        qb.push(", tbsa_percentage = ")
            .push_bind(assessment.tbsa_percentage);
        qb.push(", burn_depth = ").push_bind(&assessment.burn_depth);
        qb.push(", affected_areas = ")
            .push_bind(&assessment.affected_areas);
        qb.push(", inhalation_injury = ")
            .push_bind(assessment.inhalation_injury);
        qb.push(", inhalation_symptoms = ")
            .push_bind(&assessment.inhalation_symptoms);
        qb.push(", airway_status = ")
            .push_bind(&assessment.airway_status);
        qb.push(", circumferential_burns = ")
            .push_bind(assessment.circumferential_burns);
        qb.push(", escharotomy_needed = ")
            .push_bind(assessment.escharotomy_needed);
        qb.push(", escharotomy_performed = ")
            .push_bind(assessment.escharotomy_performed);
        qb.push(", fluid_resuscitation_started = ")
            .push_bind(assessment.fluid_resuscitation_started);
        qb.push(", parkland_formula_volume = ")
            .push_bind(assessment.parkland_formula_volume);
        qb.push(", transfer_to_burn_center = ")
            .push_bind(assessment.transfer_to_burn_center);
        qb.push(", burn_center_notified = ")
            .push_bind(assessment.burn_center_notified);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<BurnAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_severe_burns(
        &self,
        min_tbsa: Decimal,
    ) -> RepositoryResult<Vec<BurnAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM burn_assessments WHERE tbsa_percentage >= ");
        qb.push_bind(min_tbsa);
        qb.push(" ORDER BY tbsa_percentage DESC, assessment_datetime DESC");

        let items = qb
            .build_query_as::<BurnAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// PSYCHIATRIC ASSESSMENT REPOSITORY
// =============================================================================

/// PostgreSQL-backed psychiatric assessment repository
#[derive(Debug, Clone)]
pub struct PgPsychiatricAssessmentRepository {
    pool: PgPool,
}

impl PgPsychiatricAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PsychiatricAssessmentRepository for PgPsychiatricAssessmentRepository {
    async fn create(
        &self,
        assessment: PsychiatricAssessmentEntity,
    ) -> RepositoryResult<PsychiatricAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO psychiatric_assessments (
                id, patient_id, assessed_by, assessment_datetime, chief_complaint,
                presenting_symptoms, psychiatric_history, previous_hospitalizations,
                current_medications, substance_use, suicidal_ideation, suicidal_plan,
                suicidal_intent, suicidal_means_access, homicidal_ideation, homicidal_target,
                safety_plan, mental_status_exam, appearance, behavior, speech, mood,
                affect, thought_process, thought_content, perceptions, cognition,
                insight, judgment, risk_level, disposition, involuntary_hold, hold_type,
                sitter_required, one_to_one_observation, psychiatry_consulted, psychiatrist_id, notes
            ) "
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.assessed_by)
                .push_bind(a.assessment_datetime)
                .push_bind(&a.chief_complaint)
                .push_bind(&a.presenting_symptoms)
                .push_bind(&a.psychiatric_history)
                .push_bind(&a.previous_hospitalizations)
                .push_bind(&a.current_medications)
                .push_bind(&a.substance_use)
                .push_bind(a.suicidal_ideation)
                .push_bind(a.suicidal_plan)
                .push_bind(a.suicidal_intent)
                .push_bind(a.suicidal_means_access)
                .push_bind(a.homicidal_ideation)
                .push_bind(&a.homicidal_target)
                .push_bind(&a.safety_plan)
                .push_bind(&a.mental_status_exam)
                .push_bind(&a.appearance)
                .push_bind(&a.behavior)
                .push_bind(&a.speech)
                .push_bind(&a.mood)
                .push_bind(&a.affect)
                .push_bind(&a.thought_process)
                .push_bind(&a.thought_content)
                .push_bind(&a.perceptions)
                .push_bind(&a.cognition)
                .push_bind(&a.insight)
                .push_bind(&a.judgment)
                .push_bind(&a.risk_level)
                .push_bind(&a.disposition)
                .push_bind(a.involuntary_hold)
                .push_bind(&a.hold_type)
                .push_bind(a.sitter_required)
                .push_bind(a.one_to_one_observation)
                .push_bind(a.psychiatry_consulted)
                .push_bind(&a.psychiatrist_id)
                .push_bind(&a.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PsychiatricAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PsychiatricAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM psychiatric_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<PsychiatricAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PsychiatricAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM psychiatric_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM psychiatric_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessment_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<PsychiatricAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        assessment: PsychiatricAssessmentEntity,
    ) -> RepositoryResult<PsychiatricAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE psychiatric_assessments SET ");
        qb.push("chief_complaint = ")
            .push_bind(&assessment.chief_complaint);
        qb.push(", presenting_symptoms = ")
            .push_bind(&assessment.presenting_symptoms);
        qb.push(", suicidal_ideation = ")
            .push_bind(assessment.suicidal_ideation);
        qb.push(", suicidal_plan = ")
            .push_bind(assessment.suicidal_plan);
        qb.push(", suicidal_intent = ")
            .push_bind(assessment.suicidal_intent);
        qb.push(", homicidal_ideation = ")
            .push_bind(assessment.homicidal_ideation);
        qb.push(", risk_level = ").push_bind(&assessment.risk_level);
        qb.push(", disposition = ")
            .push_bind(&assessment.disposition);
        qb.push(", involuntary_hold = ")
            .push_bind(assessment.involuntary_hold);
        qb.push(", hold_type = ").push_bind(&assessment.hold_type);
        qb.push(", sitter_required = ")
            .push_bind(assessment.sitter_required);
        qb.push(", one_to_one_observation = ")
            .push_bind(assessment.one_to_one_observation);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PsychiatricAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_high_risk(&self) -> RepositoryResult<Vec<PsychiatricAssessmentEntity>> {
        // Uses the v_high_risk_patients view
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM psychiatric_assessments 
             WHERE suicidal_ideation = true OR homicidal_ideation = true 
             OR risk_level IN ('high', 'critical')
             ORDER BY assessment_datetime DESC",
        );

        let items = qb
            .build_query_as::<PsychiatricAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_risk_level(
        &self,
        risk_level: &str,
    ) -> RepositoryResult<Vec<PsychiatricAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM psychiatric_assessments WHERE risk_level = ");
        qb.push_bind(risk_level);
        qb.push(" ORDER BY assessment_datetime DESC");

        let items = qb
            .build_query_as::<PsychiatricAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// TOXICOLOGY ASSESSMENT REPOSITORY
// =============================================================================

/// PostgreSQL-backed toxicology assessment repository
#[derive(Debug, Clone)]
pub struct PgToxicologyAssessmentRepository {
    pool: PgPool,
}

impl PgToxicologyAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ToxicologyAssessmentRepository for PgToxicologyAssessmentRepository {
    async fn create(
        &self,
        assessment: ToxicologyAssessmentEntity,
    ) -> RepositoryResult<ToxicologyAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO toxicology_assessments (
                id, patient_id, assessed_by, assessment_datetime, exposure_type,
                intentionality, substances, time_of_exposure, amount_if_known,
                route_of_exposure, symptoms, vital_signs_on_arrival, mental_status,
                pupil_size, pupil_reactivity, skin_findings, toxidrome,
                decontamination_performed, decontamination_type, antidote_given,
                antidote_name, antidote_dose, activated_charcoal, whole_bowel_irrigation,
                enhanced_elimination, elimination_method, poison_control_called,
                poison_control_case_number, lab_results, drug_screen_results,
                serum_levels, disposition, icu_admission, notes
            ) ",
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.assessed_by)
                .push_bind(a.assessment_datetime)
                .push_bind(&a.exposure_type)
                .push_bind(&a.intentionality)
                .push_bind(&a.substances)
                .push_bind(a.time_of_exposure)
                .push_bind(&a.amount_if_known)
                .push_bind(&a.route_of_exposure)
                .push_bind(&a.symptoms)
                .push_bind(&a.vital_signs_on_arrival)
                .push_bind(&a.mental_status)
                .push_bind(&a.pupil_size)
                .push_bind(&a.pupil_reactivity)
                .push_bind(&a.skin_findings)
                .push_bind(&a.toxidrome)
                .push_bind(a.decontamination_performed)
                .push_bind(&a.decontamination_type)
                .push_bind(a.antidote_given)
                .push_bind(&a.antidote_name)
                .push_bind(&a.antidote_dose)
                .push_bind(a.activated_charcoal)
                .push_bind(a.whole_bowel_irrigation)
                .push_bind(a.enhanced_elimination)
                .push_bind(&a.elimination_method)
                .push_bind(a.poison_control_called)
                .push_bind(&a.poison_control_case_number)
                .push_bind(&a.lab_results)
                .push_bind(&a.drug_screen_results)
                .push_bind(&a.serum_levels)
                .push_bind(&a.disposition)
                .push_bind(a.icu_admission)
                .push_bind(&a.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ToxicologyAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ToxicologyAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM toxicology_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<ToxicologyAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ToxicologyAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM toxicology_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM toxicology_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessment_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<ToxicologyAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        assessment: ToxicologyAssessmentEntity,
    ) -> RepositoryResult<ToxicologyAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE toxicology_assessments SET ");
        qb.push("symptoms = ").push_bind(&assessment.symptoms);
        qb.push(", mental_status = ")
            .push_bind(&assessment.mental_status);
        qb.push(", toxidrome = ").push_bind(&assessment.toxidrome);
        qb.push(", decontamination_performed = ")
            .push_bind(assessment.decontamination_performed);
        qb.push(", decontamination_type = ")
            .push_bind(&assessment.decontamination_type);
        qb.push(", antidote_given = ")
            .push_bind(assessment.antidote_given);
        qb.push(", antidote_name = ")
            .push_bind(&assessment.antidote_name);
        qb.push(", antidote_dose = ")
            .push_bind(&assessment.antidote_dose);
        qb.push(", lab_results = ")
            .push_bind(&assessment.lab_results);
        qb.push(", drug_screen_results = ")
            .push_bind(&assessment.drug_screen_results);
        qb.push(", disposition = ")
            .push_bind(&assessment.disposition);
        qb.push(", icu_admission = ")
            .push_bind(assessment.icu_admission);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ToxicologyAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_exposure_type(
        &self,
        exposure_type: &str,
    ) -> RepositoryResult<Vec<ToxicologyAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM toxicology_assessments WHERE exposure_type = ");
        qb.push_bind(exposure_type);
        qb.push(" ORDER BY assessment_datetime DESC");

        let items = qb
            .build_query_as::<ToxicologyAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// PEDIATRIC ASSESSMENT REPOSITORY
// =============================================================================

/// PostgreSQL-backed pediatric assessment repository
#[derive(Debug, Clone)]
pub struct PgPediatricAssessmentRepository {
    pool: PgPool,
}

impl PgPediatricAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PediatricAssessmentRepository for PgPediatricAssessmentRepository {
    async fn create(
        &self,
        assessment: PediatricAssessmentEntity,
    ) -> RepositoryResult<PediatricAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO pediatric_assessments (
                id, patient_id, assessed_by, assessment_datetime, age_months,
                weight_kg, weight_estimated, length_cm, head_circumference_cm,
                broselow_color, chief_complaint, history_source, immunizations_up_to_date,
                last_immunization_date, developmental_milestones, developmental_concerns,
                birth_history, feeding_pattern, last_feed_time, wet_diapers_24hr,
                activity_level, pediatric_triangle, appearance_score, work_of_breathing,
                circulation_to_skin, pain_scale_type, pain_score, fontanelle_status,
                capillary_refill_seconds, skin_turgor, mucous_membranes,
                parent_guardian_present, parent_guardian_name, parent_guardian_relationship,
                child_protective_concerns, cps_notified, notes
            ) ",
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.assessed_by)
                .push_bind(a.assessment_datetime)
                .push_bind(a.age_months)
                .push_bind(a.weight_kg)
                .push_bind(a.weight_estimated)
                .push_bind(a.length_cm)
                .push_bind(a.head_circumference_cm)
                .push_bind(&a.broselow_color)
                .push_bind(&a.chief_complaint)
                .push_bind(&a.history_source)
                .push_bind(a.immunizations_up_to_date)
                .push_bind(a.last_immunization_date)
                .push_bind(&a.developmental_milestones)
                .push_bind(&a.developmental_concerns)
                .push_bind(&a.birth_history)
                .push_bind(&a.feeding_pattern)
                .push_bind(a.last_feed_time)
                .push_bind(a.wet_diapers_24hr)
                .push_bind(&a.activity_level)
                .push_bind(&a.pediatric_triangle)
                .push_bind(&a.appearance_score)
                .push_bind(&a.work_of_breathing)
                .push_bind(&a.circulation_to_skin)
                .push_bind(&a.pain_scale_type)
                .push_bind(a.pain_score)
                .push_bind(&a.fontanelle_status)
                .push_bind(a.capillary_refill_seconds)
                .push_bind(&a.skin_turgor)
                .push_bind(&a.mucous_membranes)
                .push_bind(a.parent_guardian_present)
                .push_bind(&a.parent_guardian_name)
                .push_bind(&a.parent_guardian_relationship)
                .push_bind(a.child_protective_concerns)
                .push_bind(a.cps_notified)
                .push_bind(&a.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PediatricAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PediatricAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pediatric_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<PediatricAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PediatricAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM pediatric_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pediatric_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessment_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<PediatricAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        assessment: PediatricAssessmentEntity,
    ) -> RepositoryResult<PediatricAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE pediatric_assessments SET ");
        qb.push("weight_kg = ").push_bind(assessment.weight_kg);
        qb.push(", weight_estimated = ")
            .push_bind(assessment.weight_estimated);
        qb.push(", activity_level = ")
            .push_bind(&assessment.activity_level);
        qb.push(", pediatric_triangle = ")
            .push_bind(&assessment.pediatric_triangle);
        qb.push(", pain_score = ").push_bind(assessment.pain_score);
        qb.push(", fontanelle_status = ")
            .push_bind(&assessment.fontanelle_status);
        qb.push(", capillary_refill_seconds = ")
            .push_bind(assessment.capillary_refill_seconds);
        qb.push(", child_protective_concerns = ")
            .push_bind(assessment.child_protective_concerns);
        qb.push(", cps_notified = ")
            .push_bind(assessment.cps_notified);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PediatricAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_cps_concerns(&self) -> RepositoryResult<Vec<PediatricAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM pediatric_assessments 
             WHERE child_protective_concerns = true 
             ORDER BY assessment_datetime DESC",
        );

        let items = qb
            .build_query_as::<PediatricAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// OBSTETRIC EMERGENCY REPOSITORY
// =============================================================================

/// PostgreSQL-backed obstetric emergency repository
#[derive(Debug, Clone)]
pub struct PgObstetricEmergencyRepository {
    pool: PgPool,
}

impl PgObstetricEmergencyRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ObstetricEmergencyRepository for PgObstetricEmergencyRepository {
    async fn create(
        &self,
        emergency: ObstetricEmergencyEntity,
    ) -> RepositoryResult<ObstetricEmergencyEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO obstetric_emergencies (
                id, patient_id, assessed_by, assessment_datetime, gestational_age_weeks,
                gestational_age_days, gravida, para, abortions, living_children,
                lmp_date, edd_date, prenatal_care, prenatal_care_provider,
                pregnancy_complications, chief_complaint, contractions,
                contraction_frequency_min, contraction_duration_sec, rupture_of_membranes,
                rom_time, fluid_color, vaginal_bleeding, bleeding_amount,
                cervical_exam_performed, dilation_cm, effacement_percent, station,
                presentation, fetal_heart_rate, fetal_heart_variability, fetal_decelerations,
                uterine_tenderness, fundal_height_cm, fetal_movement, emergency_type,
                placenta_previa, placental_abruption, cord_prolapse, eclampsia,
                preeclampsia_severe, blood_pressure_systolic, blood_pressure_diastolic,
                proteinuria, magnesium_sulfate_given, delivery_imminent, ob_notified,
                ob_physician_id, nicu_notified, or_notified, notes
            ) ",
        );

        qb.push_values([&emergency], |mut b, e| {
            b.push_bind(&e.id)
                .push_bind(&e.patient_id)
                .push_bind(&e.assessed_by)
                .push_bind(e.assessment_datetime)
                .push_bind(e.gestational_age_weeks)
                .push_bind(e.gestational_age_days)
                .push_bind(e.gravida)
                .push_bind(e.para)
                .push_bind(e.abortions)
                .push_bind(e.living_children)
                .push_bind(e.lmp_date)
                .push_bind(e.edd_date)
                .push_bind(e.prenatal_care)
                .push_bind(&e.prenatal_care_provider)
                .push_bind(&e.pregnancy_complications)
                .push_bind(&e.chief_complaint)
                .push_bind(e.contractions)
                .push_bind(e.contraction_frequency_min)
                .push_bind(e.contraction_duration_sec)
                .push_bind(e.rupture_of_membranes)
                .push_bind(e.rom_time)
                .push_bind(&e.fluid_color)
                .push_bind(e.vaginal_bleeding)
                .push_bind(&e.bleeding_amount)
                .push_bind(e.cervical_exam_performed)
                .push_bind(e.dilation_cm)
                .push_bind(e.effacement_percent)
                .push_bind(e.station)
                .push_bind(&e.presentation)
                .push_bind(e.fetal_heart_rate)
                .push_bind(&e.fetal_heart_variability)
                .push_bind(&e.fetal_decelerations)
                .push_bind(e.uterine_tenderness)
                .push_bind(e.fundal_height_cm)
                .push_bind(&e.fetal_movement)
                .push_bind(&e.emergency_type)
                .push_bind(e.placenta_previa)
                .push_bind(e.placental_abruption)
                .push_bind(e.cord_prolapse)
                .push_bind(e.eclampsia)
                .push_bind(e.preeclampsia_severe)
                .push_bind(e.blood_pressure_systolic)
                .push_bind(e.blood_pressure_diastolic)
                .push_bind(&e.proteinuria)
                .push_bind(e.magnesium_sulfate_given)
                .push_bind(e.delivery_imminent)
                .push_bind(e.ob_notified)
                .push_bind(&e.ob_physician_id)
                .push_bind(e.nicu_notified)
                .push_bind(e.or_notified)
                .push_bind(&e.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ObstetricEmergencyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ObstetricEmergencyEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM obstetric_emergencies WHERE id = ");
        qb.push_bind(id);

        let emergency = qb
            .build_query_as::<ObstetricEmergencyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(emergency)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ObstetricEmergencyEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM obstetric_emergencies WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM obstetric_emergencies WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessment_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<ObstetricEmergencyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        emergency: ObstetricEmergencyEntity,
    ) -> RepositoryResult<ObstetricEmergencyEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE obstetric_emergencies SET ");
        qb.push("contractions = ").push_bind(emergency.contractions);
        qb.push(", contraction_frequency_min = ")
            .push_bind(emergency.contraction_frequency_min);
        qb.push(", rupture_of_membranes = ")
            .push_bind(emergency.rupture_of_membranes);
        qb.push(", rom_time = ").push_bind(emergency.rom_time);
        qb.push(", vaginal_bleeding = ")
            .push_bind(emergency.vaginal_bleeding);
        qb.push(", dilation_cm = ").push_bind(emergency.dilation_cm);
        qb.push(", fetal_heart_rate = ")
            .push_bind(emergency.fetal_heart_rate);
        qb.push(", fetal_decelerations = ")
            .push_bind(&emergency.fetal_decelerations);
        qb.push(", emergency_type = ")
            .push_bind(&emergency.emergency_type);
        qb.push(", delivery_imminent = ")
            .push_bind(emergency.delivery_imminent);
        qb.push(", ob_notified = ").push_bind(emergency.ob_notified);
        qb.push(", nicu_notified = ")
            .push_bind(emergency.nicu_notified);
        qb.push(", or_notified = ").push_bind(emergency.or_notified);
        qb.push(", notes = ").push_bind(&emergency.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&emergency.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ObstetricEmergencyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_active_emergencies(&self) -> RepositoryResult<Vec<ObstetricEmergencyEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM obstetric_emergencies 
             WHERE delivery_imminent = true OR eclampsia = true 
             OR cord_prolapse = true OR placental_abruption = true
             ORDER BY assessment_datetime DESC",
        );

        let items = qb
            .build_query_as::<ObstetricEmergencyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
