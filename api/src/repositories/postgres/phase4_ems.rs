//! PostgreSQL implementations for Phase 6 EMS & External repositories.
//!
//! This module uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use chrono::Utc;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// EMS HANDOFF REPOSITORY
// =============================================================================

/// PostgreSQL-backed EMS handoff repository
#[derive(Debug, Clone)]
pub struct PgEmsHandoffRepository {
    pool: PgPool,
}

impl PgEmsHandoffRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl EmsHandoffRepository for PgEmsHandoffRepository {
    async fn create(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO ems_handoffs (
                id, patient_id, receiving_provider_id, handoff_datetime, ems_agency,
                ems_unit_number, crew_members, run_number, dispatch_time, on_scene_time,
                transport_start_time, arrival_time, scene_address, incident_type,
                chief_complaint, mechanism_of_injury, patient_found, mental_status_on_scene,
                gcs_on_scene, vital_signs_on_scene, vital_signs_transport, vital_signs_arrival,
                interventions_performed, medications_given, iv_access_obtained, iv_details,
                airway_management, cpr_performed, aed_used, shocks_delivered,
                spinal_immobilization, splinting_performed, tourniquet_applied,
                bleeding_controlled, patient_belongings, family_at_scene, family_contact_info,
                police_at_scene, police_report_number, trauma_alert, stroke_alert,
                stemi_alert, sepsis_alert, report_received_by, report_received_time,
                verbal_report_complete, ems_documentation_received, notes
            ) ",
        );

        qb.push_values([&handoff], |mut b, h| {
            b.push_bind(&h.id)
                .push_bind(&h.patient_id)
                .push_bind(&h.receiving_provider_id)
                .push_bind(h.handoff_datetime)
                .push_bind(&h.ems_agency)
                .push_bind(&h.ems_unit_number)
                .push_bind(&h.crew_members)
                .push_bind(&h.run_number)
                .push_bind(h.dispatch_time)
                .push_bind(h.on_scene_time)
                .push_bind(h.transport_start_time)
                .push_bind(h.arrival_time)
                .push_bind(&h.scene_address)
                .push_bind(&h.incident_type)
                .push_bind(&h.chief_complaint)
                .push_bind(&h.mechanism_of_injury)
                .push_bind(&h.patient_found)
                .push_bind(&h.mental_status_on_scene)
                .push_bind(h.gcs_on_scene)
                .push_bind(&h.vital_signs_on_scene)
                .push_bind(&h.vital_signs_transport)
                .push_bind(&h.vital_signs_arrival)
                .push_bind(&h.interventions_performed)
                .push_bind(&h.medications_given)
                .push_bind(h.iv_access_obtained)
                .push_bind(&h.iv_details)
                .push_bind(&h.airway_management)
                .push_bind(h.cpr_performed)
                .push_bind(h.aed_used)
                .push_bind(h.shocks_delivered)
                .push_bind(h.spinal_immobilization)
                .push_bind(h.splinting_performed)
                .push_bind(h.tourniquet_applied)
                .push_bind(h.bleeding_controlled)
                .push_bind(&h.patient_belongings)
                .push_bind(h.family_at_scene)
                .push_bind(&h.family_contact_info)
                .push_bind(h.police_at_scene)
                .push_bind(&h.police_report_number)
                .push_bind(h.trauma_alert)
                .push_bind(h.stroke_alert)
                .push_bind(h.stemi_alert)
                .push_bind(h.sepsis_alert)
                .push_bind(&h.report_received_by)
                .push_bind(h.report_received_time)
                .push_bind(h.verbal_report_complete)
                .push_bind(h.ems_documentation_received)
                .push_bind(&h.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<EmsHandoffEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<EmsHandoffEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM ems_handoffs WHERE id = ");
        qb.push_bind(id);

        let handoff = qb
            .build_query_as::<EmsHandoffEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(handoff)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EmsHandoffEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM ems_handoffs WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM ems_handoffs WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY arrival_time DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<EmsHandoffEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE ems_handoffs SET ");
        qb.push("patient_id = ").push_bind(&handoff.patient_id);
        qb.push(", vital_signs_arrival = ")
            .push_bind(&handoff.vital_signs_arrival);
        qb.push(", interventions_performed = ")
            .push_bind(&handoff.interventions_performed);
        qb.push(", report_received_by = ")
            .push_bind(&handoff.report_received_by);
        qb.push(", report_received_time = ")
            .push_bind(handoff.report_received_time);
        qb.push(", verbal_report_complete = ")
            .push_bind(handoff.verbal_report_complete);
        qb.push(", ems_documentation_received = ")
            .push_bind(handoff.ems_documentation_received);
        qb.push(", notes = ").push_bind(&handoff.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&handoff.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<EmsHandoffEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_recent(&self, hours: i32) -> RepositoryResult<Vec<EmsHandoffEntity>> {
        let cutoff = Utc::now() - chrono::Duration::hours(hours as i64);

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM ems_handoffs WHERE arrival_time >= ");
        qb.push_bind(cutoff);
        qb.push(" ORDER BY arrival_time DESC");

        let items = qb
            .build_query_as::<EmsHandoffEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_alerts(&self) -> RepositoryResult<Vec<EmsHandoffEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM ems_handoffs 
             WHERE trauma_alert = true OR stroke_alert = true 
             OR stemi_alert = true OR sepsis_alert = true
             ORDER BY arrival_time DESC",
        );

        let items = qb
            .build_query_as::<EmsHandoffEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// MCI RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed MCI record repository
#[derive(Debug, Clone)]
pub struct PgMciRecordRepository {
    pool: PgPool,
}

impl PgMciRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MciRecordRepository for PgMciRecordRepository {
    async fn create(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO mci_records (
                id, incident_id, incident_name, incident_datetime, incident_location,
                incident_type, activation_level, incident_commander, medical_branch_director,
                hospital_incident_command_activated, patient_id, triage_tag_number,
                triage_category, start_triage_category, arrival_datetime, arrival_mode,
                ems_agency, treatment_area, injuries, mechanism_of_injury,
                decontamination_required, decontamination_completed, treatments_provided,
                disposition, disposition_datetime, destination, family_notified,
                family_reunification_completed, patient_tracking_updated,
                media_release_authorized, special_circumstances, created_by
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.incident_id)
                .push_bind(&r.incident_name)
                .push_bind(r.incident_datetime)
                .push_bind(&r.incident_location)
                .push_bind(&r.incident_type)
                .push_bind(&r.activation_level)
                .push_bind(&r.incident_commander)
                .push_bind(&r.medical_branch_director)
                .push_bind(r.hospital_incident_command_activated)
                .push_bind(&r.patient_id)
                .push_bind(&r.triage_tag_number)
                .push_bind(&r.triage_category)
                .push_bind(&r.start_triage_category)
                .push_bind(r.arrival_datetime)
                .push_bind(&r.arrival_mode)
                .push_bind(&r.ems_agency)
                .push_bind(&r.treatment_area)
                .push_bind(&r.injuries)
                .push_bind(&r.mechanism_of_injury)
                .push_bind(r.decontamination_required)
                .push_bind(r.decontamination_completed)
                .push_bind(&r.treatments_provided)
                .push_bind(&r.disposition)
                .push_bind(r.disposition_datetime)
                .push_bind(&r.destination)
                .push_bind(r.family_notified)
                .push_bind(r.family_reunification_completed)
                .push_bind(r.patient_tracking_updated)
                .push_bind(r.media_release_authorized)
                .push_bind(&r.special_circumstances)
                .push_bind(&r.created_by);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<MciRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MciRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM mci_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<MciRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_incident(&self, incident_id: &str) -> RepositoryResult<Vec<MciRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM mci_records WHERE incident_id = ");
        qb.push_bind(incident_id);
        qb.push(" ORDER BY arrival_datetime ASC");

        let items = qb
            .build_query_as::<MciRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<MciRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM mci_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY incident_datetime DESC");

        let items = qb
            .build_query_as::<MciRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE mci_records SET ");
        qb.push("patient_id = ").push_bind(&record.patient_id);
        qb.push(", triage_category = ")
            .push_bind(&record.triage_category);
        qb.push(", treatment_area = ")
            .push_bind(&record.treatment_area);
        qb.push(", treatments_provided = ")
            .push_bind(&record.treatments_provided);
        qb.push(", disposition = ").push_bind(&record.disposition);
        qb.push(", disposition_datetime = ")
            .push_bind(record.disposition_datetime);
        qb.push(", destination = ").push_bind(&record.destination);
        qb.push(", family_notified = ")
            .push_bind(record.family_notified);
        qb.push(", family_reunification_completed = ")
            .push_bind(record.family_reunification_completed);
        qb.push(", patient_tracking_updated = ")
            .push_bind(record.patient_tracking_updated);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<MciRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_active_incidents(&self) -> RepositoryResult<Vec<MciRecordEntity>> {
        // Uses the v_mci_active view
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM mci_records 
             WHERE disposition IS NULL
             ORDER BY incident_datetime DESC, arrival_datetime ASC",
        );

        let items = qb
            .build_query_as::<MciRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_triage_category(
        &self,
        incident_id: &str,
        category: &str,
    ) -> RepositoryResult<Vec<MciRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM mci_records WHERE incident_id = ");
        qb.push_bind(incident_id);
        qb.push(" AND triage_category = ");
        qb.push_bind(category);
        qb.push(" ORDER BY arrival_datetime ASC");

        let items = qb
            .build_query_as::<MciRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// CHAIN OF CUSTODY REPOSITORY
// =============================================================================

/// PostgreSQL-backed chain of custody repository
#[derive(Debug, Clone)]
pub struct PgChainOfCustodyRepository {
    pool: PgPool,
}

impl PgChainOfCustodyRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ChainOfCustodyRepository for PgChainOfCustodyRepository {
    async fn create(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO chain_of_custody (
                id, patient_id, case_number, evidence_type, evidence_description,
                quantity, unit_of_measure, collection_datetime, collection_location,
                collected_by, collection_witnessed_by, collection_method,
                packaging_description, seal_number, storage_location, storage_requirements,
                current_custodian_id, transfers, law_enforcement_agency,
                law_enforcement_officer, law_enforcement_badge, warrant_number,
                court_order_number, released_to, release_datetime, release_authorized_by,
                release_documentation, destruction_authorized, destruction_datetime,
                destruction_method, destruction_witnessed_by, status, photos_taken,
                photo_references, notes
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.case_number)
                .push_bind(&r.evidence_type)
                .push_bind(&r.evidence_description)
                .push_bind(r.quantity)
                .push_bind(&r.unit_of_measure)
                .push_bind(r.collection_datetime)
                .push_bind(&r.collection_location)
                .push_bind(&r.collected_by)
                .push_bind(&r.collection_witnessed_by)
                .push_bind(&r.collection_method)
                .push_bind(&r.packaging_description)
                .push_bind(&r.seal_number)
                .push_bind(&r.storage_location)
                .push_bind(&r.storage_requirements)
                .push_bind(&r.current_custodian_id)
                .push_bind(&r.transfers)
                .push_bind(&r.law_enforcement_agency)
                .push_bind(&r.law_enforcement_officer)
                .push_bind(&r.law_enforcement_badge)
                .push_bind(&r.warrant_number)
                .push_bind(&r.court_order_number)
                .push_bind(&r.released_to)
                .push_bind(r.release_datetime)
                .push_bind(&r.release_authorized_by)
                .push_bind(&r.release_documentation)
                .push_bind(r.destruction_authorized)
                .push_bind(r.destruction_datetime)
                .push_bind(&r.destruction_method)
                .push_bind(&r.destruction_witnessed_by)
                .push_bind(&r.status)
                .push_bind(r.photos_taken)
                .push_bind(&r.photo_references)
                .push_bind(&r.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ChainOfCustodyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ChainOfCustodyEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM chain_of_custody WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<ChainOfCustodyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM chain_of_custody WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY collection_datetime DESC");

        let items = qb
            .build_query_as::<ChainOfCustodyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_case(&self, case_number: &str) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM chain_of_custody WHERE case_number = ");
        qb.push_bind(case_number);
        qb.push(" ORDER BY collection_datetime ASC");

        let items = qb
            .build_query_as::<ChainOfCustodyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE chain_of_custody SET ");
        qb.push("storage_location = ")
            .push_bind(&record.storage_location);
        qb.push(", current_custodian_id = ")
            .push_bind(&record.current_custodian_id);
        qb.push(", transfers = ").push_bind(&record.transfers);
        qb.push(", status = ").push_bind(&record.status);
        qb.push(", released_to = ").push_bind(&record.released_to);
        qb.push(", release_datetime = ")
            .push_bind(record.release_datetime);
        qb.push(", notes = ").push_bind(&record.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ChainOfCustodyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn transfer(
        &self,
        id: &str,
        new_custodian_id: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<ChainOfCustodyEntity> {
        // First get the current record
        let mut get_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM chain_of_custody WHERE id = ");
        get_qb.push_bind(id);

        let current = get_qb
            .build_query_as::<ChainOfCustodyEntity>()
            .fetch_one(&self.pool)
            .await?;

        // Build the transfer record
        let transfer = serde_json::json!({
            "from": current.current_custodian_id,
            "to": new_custodian_id,
            "datetime": Utc::now().to_rfc3339(),
            "notes": notes
        });

        let mut transfers = if let Some(arr) = current.transfers.as_array() {
            arr.clone()
        } else {
            vec![]
        };
        transfers.push(transfer);
        let new_transfers = serde_json::Value::Array(transfers);

        // Update the record
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE chain_of_custody SET ");
        qb.push("current_custodian_id = ")
            .push_bind(new_custodian_id);
        qb.push(", transfers = ").push_bind(&new_transfers);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ChainOfCustodyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_custodian(
        &self,
        custodian_id: &str,
    ) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM chain_of_custody WHERE current_custodian_id = ");
        qb.push_bind(custodian_id);
        qb.push(" ORDER BY collection_datetime DESC");

        let items = qb
            .build_query_as::<ChainOfCustodyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
