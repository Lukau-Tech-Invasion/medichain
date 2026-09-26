//! One read per section of a patient's record (WP11), shared by each section's
//! own endpoint (`patient_documents`) and by the combined records summary.
//!
//! Each read returns the JSON body its endpoint has always returned, or the
//! storage error. It never turns an error into an empty list: "no discharge
//! summary" and "the discharge summaries could not be read" must not look the
//! same to a patient (the endpoints used to do exactly that).

use crate::repositories::traits::{JsonRecordEntity, Pagination, RepositoryResult};
use crate::state::AppState;
use serde_json::{json, Value};

/// The sections, in the order the patient's records page shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecordSection {
    HistoryPhysicals,
    ProgressNotes,
    Wounds,
    Vitals,
    Discharges,
    Imaging,
    Pathology,
    Consults,
    CarePlans,
    Blood,
    Procedures,
    AmaDischarges,
    IntakeOutput,
    PharmacyDecisions,
    EmsHandoffs,
}

impl RecordSection {
    /// Every section, for the combined summary.
    pub(crate) const ALL: [RecordSection; 15] = [
        Self::HistoryPhysicals,
        Self::ProgressNotes,
        Self::Wounds,
        Self::Vitals,
        Self::Discharges,
        Self::Imaging,
        Self::Pathology,
        Self::Consults,
        Self::CarePlans,
        Self::Blood,
        Self::Procedures,
        Self::AmaDischarges,
        Self::IntakeOutput,
        Self::PharmacyDecisions,
        Self::EmsHandoffs,
    ];

    /// The section's key: the last path segment of its own endpoint.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::HistoryPhysicals => "history-physicals",
            Self::ProgressNotes => "progress-notes",
            Self::Wounds => "wounds",
            Self::Vitals => "vitals",
            Self::Discharges => "discharges",
            Self::Imaging => "imaging",
            Self::Pathology => "pathology",
            Self::Consults => "consults",
            Self::CarePlans => "care-plans",
            Self::Blood => "blood",
            Self::Procedures => "procedures",
            Self::AmaDischarges => "ama-discharges",
            Self::IntakeOutput => "intake-output",
            Self::PharmacyDecisions => "pharmacy-decisions",
            Self::EmsHandoffs => "ems-handoffs",
        }
    }
}

/// One page of a list that its store returns whole (JSON-record stores).
fn page_of<T>(items: Vec<T>, page: Pagination) -> Vec<T> {
    items
        .into_iter()
        .skip(page.offset() as usize)
        .take(page.limit() as usize)
        .collect()
}

/// The `data` of each JSON record, one page of them.
fn record_data(rows: Vec<JsonRecordEntity>, page: Pagination) -> Vec<Value> {
    page_of(rows, page)
        .into_iter()
        .map(|row| row.data)
        .collect()
}

/// Read one section of `patient_id`'s record as its endpoint returns it.
pub(crate) async fn read_section(
    data: &AppState,
    patient_id: &str,
    section: RecordSection,
    page: Pagination,
) -> RepositoryResult<Value> {
    use RecordSection as S;
    match section {
        S::HistoryPhysicals
        | S::ProgressNotes
        | S::Wounds
        | S::Consults
        | S::CarePlans
        | S::AmaDischarges
        | S::Pathology => single_list(data, patient_id, section, page).await,
        S::Vitals => vitals(data, patient_id, page).await,
        S::Discharges => discharges(data, patient_id, page).await,
        S::Imaging => imaging(data, patient_id, page).await,
        S::Blood => blood(data, patient_id, page).await,
        S::Procedures => procedures(data, patient_id, page).await,
        S::IntakeOutput => intake_output(data, patient_id, page).await,
        S::PharmacyDecisions => pharmacy_decisions(data, patient_id, page).await,
        S::EmsHandoffs => ems_handoffs(data, patient_id, page).await,
    }
}

/// Sections that are one list from one repository.
async fn single_list(
    data: &AppState,
    id: &str,
    section: RecordSection,
    page: Pagination,
) -> RepositoryResult<Value> {
    let r = &data.repositories;
    let (field, items) = match section {
        RecordSection::HistoryPhysicals => (
            "history_physicals",
            json!(r.history_physicals.get_by_patient(id, page).await?.items),
        ),
        RecordSection::ProgressNotes => (
            "progress_notes",
            json!(r.progress_notes.get_by_patient(id, page).await?.items),
        ),
        RecordSection::Wounds => (
            "wounds",
            json!(r.wound_assessments.get_by_patient(id, page).await?.items),
        ),
        RecordSection::Consults => (
            "consults",
            json!(r.consultation_notes.get_by_patient(id, page).await?.items),
        ),
        RecordSection::CarePlans => (
            "care_plans",
            json!(r.nursing_care_plans.get_by_patient(id, page).await?.items),
        ),
        RecordSection::AmaDischarges => (
            "ama_discharges",
            json!(r.ama_discharges.get_by_patient(id, page).await?.items),
        ),
        _ => (
            "reports",
            json!(r.pathology_reports.get_by_patient(id, page).await?.items),
        ),
    };
    let count = items.as_array().map_or(0, Vec::len);
    Ok(json!({ "success": true, "patient_id": id, field: items, "count": count }))
}

async fn vitals(data: &AppState, id: &str, page: Pagination) -> RepositoryResult<Value> {
    let result = data
        .repositories
        .vital_signs
        .get_by_patient(id, page)
        .await?;
    let readings: Vec<Value> = result
        .items
        .into_iter()
        .map(super::vitals::vital_reading_json)
        .collect();
    Ok(
        json!({ "patient_id": id, "readings": readings, "total": result.total, "critical_alerts": [] }),
    )
}

async fn discharges(data: &AppState, id: &str, page: Pagination) -> RepositoryResult<Value> {
    let r = &data.repositories;
    let summaries = r.discharge_summaries.get_by_patient(id, page).await?.items;
    let instructions = r
        .discharge_instructions
        .get_by_patient(id, page)
        .await?
        .items;
    let count = summaries.len() + instructions.len();
    Ok(
        json!({ "success": true, "patient_id": id, "summaries": summaries, "instructions": instructions, "count": count }),
    )
}

async fn imaging(data: &AppState, id: &str, page: Pagination) -> RepositoryResult<Value> {
    let r = &data.repositories;
    let orders = r.radiology_orders.get_by_patient(id, page).await?.items;
    let reports = r.radiology_reports.get_by_patient(id, page).await?.items;
    let count = orders.len() + reports.len();
    Ok(
        json!({ "success": true, "patient_id": id, "orders": orders, "reports": reports, "count": count }),
    )
}

async fn blood(data: &AppState, id: &str, page: Pagination) -> RepositoryResult<Value> {
    let r = &data.repositories;
    let screens = page_of(r.blood_type_screen_records.get_by_owner(id).await?, page);
    let transfusions = page_of(r.transfusion_event_records.get_by_owner(id).await?, page);
    let count = screens.len() + transfusions.len();
    Ok(
        json!({ "success": true, "patient_id": id, "screens": screens, "transfusions": transfusions, "count": count }),
    )
}

async fn procedures(data: &AppState, id: &str, page: Pagination) -> RepositoryResult<Value> {
    let r = &data.repositories;
    let intubations = r.intubation_records.get_by_patient(id, page).await?.items;
    let lacerations = r.laceration_repairs.get_by_patient(id, page).await?.items;
    let splints = r.splint_cast_records.get_by_patient(id, page).await?.items;
    let burns = r.burn_assessments.get_by_patient(id, page).await?.items;
    let anesthesia = r.anesthesia_records.get_by_patient(id, page).await?.items;
    let count =
        intubations.len() + lacerations.len() + splints.len() + burns.len() + anesthesia.len();
    Ok(json!({
        "success": true, "patient_id": id, "intubations": intubations,
        "laceration_repairs": lacerations, "splints_and_casts": splints,
        "burn_assessments": burns, "anesthesia_records": anesthesia, "count": count,
    }))
}

async fn intake_output(data: &AppState, id: &str, page: Pagination) -> RepositoryResult<Value> {
    let items = data
        .repositories
        .io_records
        .get_by_patient(id, None, page)
        .await?
        .items;
    let count = items.len();
    Ok(json!({ "success": true, "patient_id": id, "intake_output": items, "count": count }))
}

async fn pharmacy_decisions(
    data: &AppState,
    id: &str,
    page: Pagination,
) -> RepositoryResult<Value> {
    let decisions = record_data(
        data.repositories
            .pharmacy_decisions
            .get_by_owner(id)
            .await?,
        page,
    );
    let count = decisions.len();
    Ok(json!({ "success": true, "patient_id": id, "decisions": decisions, "count": count }))
}

async fn ems_handoffs(data: &AppState, id: &str, page: Pagination) -> RepositoryResult<Value> {
    let rows = data
        .repositories
        .ems_handoffs
        .get_by_patient(id, page)
        .await?
        .items;
    let handoffs: Vec<Value> = rows.into_iter().map(|row| row.data).collect();
    let count = handoffs.len();
    Ok(json!({ "success": true, "patient_id": id, "handoffs": handoffs, "count": count }))
}
