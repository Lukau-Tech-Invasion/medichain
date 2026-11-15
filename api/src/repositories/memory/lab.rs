//! In-memory repositories for laboratory: submissions, quality control, critical values, specimens.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// Memory-based lab submission repository
#[derive(Debug)]
pub struct MemoryLabSubmissionRepository {
    data: RwLock<HashMap<String, LabSubmissionEntity>>,
}

impl Default for MemoryLabSubmissionRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryLabSubmissionRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl LabSubmissionRepository for MemoryLabSubmissionRepository {
    async fn create(
        &self,
        submission: LabSubmissionEntity,
    ) -> RepositoryResult<LabSubmissionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&submission.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Lab submission {} already exists",
                submission.id
            )));
        }
        data.insert(submission.id.clone(), submission.clone());
        Ok(submission)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabSubmissionEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Lab submission {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabSubmissionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|s| s.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.order_date));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabSubmissionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|s| s.ordering_provider_id == provider_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.order_date));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        submission: LabSubmissionEntity,
    ) -> RepositoryResult<LabSubmissionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&submission.id) {
            return Err(RepositoryError::NotFound(format!(
                "Lab submission {} not found",
                submission.id
            )));
        }
        data.insert(submission.id.clone(), submission.clone());
        Ok(submission)
    }

    async fn get_pending_by_priority(&self) -> RepositoryResult<Vec<LabSubmissionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|s| {
                s.status == "pending" || s.status == "collected" || s.status == "in_progress"
            })
            .cloned()
            .collect();
        items.sort_by(|a, b| {
            let priority_order = |p: &str| match p {
                "stat" => 1,
                "asap" => 2,
                "urgent" => 3,
                _ => 4,
            };
            priority_order(&a.priority)
                .cmp(&priority_order(&b.priority))
                .then_with(|| a.order_date.cmp(&b.order_date))
        });
        Ok(items)
    }
}

/// Memory-based lab QC record repository
#[derive(Debug)]
pub struct MemoryLabQcRecordRepository {
    data: RwLock<HashMap<String, LabQcRecordEntity>>,
}

impl Default for MemoryLabQcRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryLabQcRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl LabQcRecordRepository for MemoryLabQcRecordRepository {
    async fn create(&self, record: LabQcRecordEntity) -> RepositoryResult<LabQcRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Lab QC record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabQcRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Lab QC record {} not found", id)))
    }

    async fn get_by_instrument(
        &self,
        instrument_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabQcRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.instrument_id == instrument_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.performed_at));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_failed_records(
        &self,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<LabQcRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| {
                if !r.passed {
                    return false;
                }
                if let Some(ref range) = date_range {
                    if let Some(from) = range.from {
                        if r.performed_at < from {
                            return false;
                        }
                    }
                    if let Some(to) = range.to {
                        if r.performed_at > to {
                            return false;
                        }
                    }
                }
                true
            })
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.performed_at));
        Ok(items)
    }

    async fn update(&self, record: LabQcRecordEntity) -> RepositoryResult<LabQcRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Lab QC record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<LabQcRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based critical value repository
#[derive(Debug)]
pub struct MemoryCriticalValueRepository {
    data: RwLock<HashMap<String, CriticalValueEntity>>,
}

impl Default for MemoryCriticalValueRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryCriticalValueRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl CriticalValueRepository for MemoryCriticalValueRepository {
    async fn create(&self, value: CriticalValueEntity) -> RepositoryResult<CriticalValueEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&value.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Critical value {} already exists",
                value.id
            )));
        }
        data.insert(value.id.clone(), value.clone());
        Ok(value)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CriticalValueEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Critical value {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CriticalValueEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|v| v.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.created_at));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_unacknowledged(&self) -> RepositoryResult<Vec<CriticalValueEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|v| v.acknowledged_at.is_none())
            .cloned()
            .collect();
        items.sort_by(|a, b| {
            let severity_order = |s: &str| match s {
                "panic" => 1,
                "critical" => 2,
                _ => 3,
            };
            severity_order(&a.severity)
                .cmp(&severity_order(&b.severity))
                .then_with(|| a.created_at.cmp(&b.created_at))
        });
        Ok(items)
    }

    async fn close(
        &self,
        id: &str,
        closure: CriticalValueClosure,
    ) -> RepositoryResult<Option<CriticalValueEntity>> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let value = data
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Critical value {} not found", id)))?;
        if value.acknowledged_at.is_some() {
            return Ok(None);
        }
        value.acknowledged_at = Some(Utc::now());
        value.acknowledged_by = Some(closure.closed_by);
        value.action_taken = Some(closure.action_taken);
        value.notified_provider_id = closure
            .notified_provider_id
            .or(value.notified_provider_id.take());
        value.notification_method = closure
            .notification_method
            .or(value.notification_method.take());
        value.notified_at = closure.notified_at.or(value.notified_at);
        value.data = closure.data;
        Ok(Some(value.clone()))
    }

    async fn list_all(&self) -> RepositoryResult<Vec<CriticalValueEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based specimen collection repository
#[derive(Debug)]
pub struct MemorySpecimenCollectionRepository {
    data: RwLock<HashMap<String, SpecimenCollectionEntity>>,
}

impl Default for MemorySpecimenCollectionRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemorySpecimenCollectionRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl SpecimenCollectionRepository for MemorySpecimenCollectionRepository {
    async fn create(
        &self,
        specimen: SpecimenCollectionEntity,
    ) -> RepositoryResult<SpecimenCollectionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&specimen.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Specimen {} already exists",
                specimen.id
            )));
        }
        data.insert(specimen.id.clone(), specimen.clone());
        Ok(specimen)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SpecimenCollectionEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Specimen {} not found", id)))
    }

    async fn get_by_barcode(
        &self,
        barcode: &str,
    ) -> RepositoryResult<Option<SpecimenCollectionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|s| s.barcode.as_deref() == Some(barcode))
            .cloned())
    }

    async fn get_by_submission(
        &self,
        submission_id: &str,
    ) -> RepositoryResult<Vec<SpecimenCollectionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|s| s.submission_id == submission_id)
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        specimen: SpecimenCollectionEntity,
    ) -> RepositoryResult<SpecimenCollectionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&specimen.id) {
            return Err(RepositoryError::NotFound(format!(
                "Specimen {} not found",
                specimen.id
            )));
        }
        data.insert(specimen.id.clone(), specimen.clone());
        Ok(specimen)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<SpecimenCollectionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based specimen rejection repository
#[derive(Debug)]
pub struct MemorySpecimenRejectionRepository {
    data: RwLock<HashMap<String, SpecimenRejectionEntity>>,
}

impl Default for MemorySpecimenRejectionRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemorySpecimenRejectionRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl SpecimenRejectionRepository for MemorySpecimenRejectionRepository {
    async fn mark_provider_notified(
        &self,
        id: &str,
        notified_at: chrono::DateTime<chrono::Utc>,
    ) -> RepositoryResult<Option<SpecimenRejectionEntity>> {
        // Read the guard and write under one lock, so this matches the
        // PostgreSQL statement's atomicity rather than merely its signature.
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let Some(existing) = data.get_mut(id) else {
            return Ok(None);
        };
        if existing.notified_ordering_provider {
            return Ok(None);
        }
        existing.notified_ordering_provider = true;
        existing.notification_sent_at = Some(notified_at);
        Ok(Some(existing.clone()))
    }

    async fn create(
        &self,
        rejection: SpecimenRejectionEntity,
    ) -> RepositoryResult<SpecimenRejectionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&rejection.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Specimen rejection {} already exists",
                rejection.id
            )));
        }
        data.insert(rejection.id.clone(), rejection.clone());
        Ok(rejection)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SpecimenRejectionEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Specimen rejection {} not found", id))
        })
    }

    async fn get_by_specimen(
        &self,
        specimen_id: &str,
    ) -> RepositoryResult<Vec<SpecimenRejectionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.specimen_id == specimen_id)
            .cloned()
            .collect())
    }

    async fn get_pending_recollections(&self) -> RepositoryResult<Vec<SpecimenRejectionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.recollection_required && r.recollection_scheduled.is_none())
            .cloned()
            .collect())
    }

    async fn list_all(&self) -> RepositoryResult<Vec<SpecimenRejectionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// In-process recollection requests (SCR-009b).
///
/// The externally visible contract matches PostgreSQL exactly -- one open
/// request per rejection, terminal states terminal, retries returning `None`
/// rather than acting twice. PostgreSQL enforces the first of those with a
/// partial unique index; here the write lock does it, which is the same
/// guarantee for a single process and is all this backend claims.
#[derive(Debug)]
pub struct MemorySpecimenRecollectionRepository {
    data: RwLock<HashMap<String, SpecimenRecollectionRequestEntity>>,
}

impl Default for MemorySpecimenRecollectionRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemorySpecimenRecollectionRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl SpecimenRecollectionRepository for MemorySpecimenRecollectionRepository {
    async fn open(
        &self,
        request: SpecimenRecollectionRequestEntity,
    ) -> RepositoryResult<Option<SpecimenRecollectionRequestEntity>> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        // The duplicate test and the insert happen under one write lock, so a
        // second caller cannot slip between them.
        let already_open = data
            .values()
            .any(|r| r.rejection_id == request.rejection_id && r.status == "requested");
        if already_open {
            return Ok(None);
        }
        data.insert(request.id.clone(), request.clone());
        Ok(Some(request))
    }

    async fn get_by_id(
        &self,
        id: &str,
    ) -> RepositoryResult<Option<SpecimenRecollectionRequestEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.get(id).cloned())
    }

    async fn list_for_rejection(
        &self,
        rejection_id: &str,
    ) -> RepositoryResult<Vec<SpecimenRecollectionRequestEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut rows: Vec<_> = data
            .values()
            .filter(|r| r.rejection_id == rejection_id)
            .cloned()
            .collect();
        // Newest first. `Reverse` rather than a comparator closure, which
        // clippy flags as `unnecessary_sort_by`.
        rows.sort_by_key(|r| std::cmp::Reverse(r.requested_at));
        Ok(rows)
    }

    async fn list_open(&self) -> RepositoryResult<Vec<SpecimenRecollectionRequestEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut rows: Vec<_> = data
            .values()
            .filter(|r| r.status == "requested")
            .cloned()
            .collect();
        // Oldest first: the laboratory works the queue in the order the
        // samples were asked for.
        rows.sort_by_key(|r| r.requested_at);
        Ok(rows)
    }

    async fn complete(
        &self,
        id: &str,
        replacement_specimen_id: &str,
        completed_at: chrono::DateTime<chrono::Utc>,
    ) -> RepositoryResult<Option<SpecimenRecollectionRequestEntity>> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        match data.get_mut(id) {
            // Only an open request completes. A second call finds `collected`
            // and returns None rather than overwriting the first replacement.
            Some(request) if request.status == "requested" => {
                request.status = "collected".to_string();
                request.replacement_specimen_id = Some(replacement_specimen_id.to_string());
                request.completed_at = Some(completed_at);
                request.updated_at = completed_at;
                Ok(Some(request.clone()))
            }
            _ => Ok(None),
        }
    }

    async fn cancel(
        &self,
        id: &str,
        reason: &str,
        cancelled_at: chrono::DateTime<chrono::Utc>,
    ) -> RepositoryResult<Option<SpecimenRecollectionRequestEntity>> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        match data.get_mut(id) {
            Some(request) if request.status == "requested" => {
                request.status = "cancelled".to_string();
                request.cancellation_reason = Some(reason.to_string());
                request.cancelled_at = Some(cancelled_at);
                request.updated_at = cancelled_at;
                Ok(Some(request.clone()))
            }
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod specimen_recollection_tests {
    use super::*;

    fn request(id: &str, rejection_id: &str) -> SpecimenRecollectionRequestEntity {
        let now = chrono::Utc::now();
        SpecimenRecollectionRequestEntity {
            id: id.to_string(),
            rejection_id: rejection_id.to_string(),
            original_specimen_id: "SPEC-ORIGINAL".to_string(),
            patient_id: "PAT-SYNTHETIC".to_string(),
            ordering_provider_id: Some("DOC-1".to_string()),
            requested_by: "LAB-1".to_string(),
            reason: "Haemolysed sample".to_string(),
            status: "requested".to_string(),
            requested_at: now,
            replacement_specimen_id: None,
            completed_at: None,
            cancelled_at: None,
            cancellation_reason: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// Two technicians looking at the same rejected specimen will both press
    /// Recollect. Only one request may open, or the patient is asked to attend
    /// twice for one failed sample.
    #[tokio::test]
    async fn only_one_recollection_may_be_open_per_rejection() {
        let repo = MemorySpecimenRecollectionRepository::new();

        let first = repo.open(request("RECOL-1", "REJ-1")).await.unwrap();
        assert!(first.is_some(), "the first request must open");

        let second = repo.open(request("RECOL-2", "REJ-1")).await.unwrap();
        assert!(
            second.is_none(),
            "a second open request for the same rejection must be refused"
        );

        // A different rejection is a different sample and is unaffected.
        let other = repo.open(request("RECOL-3", "REJ-2")).await.unwrap();
        assert!(other.is_some(), "a different rejection must not be blocked");
    }

    /// Completion is guarded, so a retried request cannot record a second
    /// replacement over the first.
    #[tokio::test]
    async fn completing_twice_records_one_replacement() {
        let repo = MemorySpecimenRecollectionRepository::new();
        repo.open(request("RECOL-1", "REJ-1")).await.unwrap();
        let now = chrono::Utc::now();

        let first = repo
            .complete("RECOL-1", "SPEC-REPLACEMENT", now)
            .await
            .unwrap()
            .expect("the first completion succeeds");
        assert_eq!(first.status, "collected");
        assert_eq!(
            first.replacement_specimen_id.as_deref(),
            Some("SPEC-REPLACEMENT")
        );

        let second = repo
            .complete("RECOL-1", "SPEC-SOMETHING-ELSE", now)
            .await
            .unwrap();
        assert!(second.is_none(), "a retry must not complete it again");

        let stored = repo.get_by_id("RECOL-1").await.unwrap().unwrap();
        assert_eq!(
            stored.replacement_specimen_id.as_deref(),
            Some("SPEC-REPLACEMENT"),
            "the first replacement must survive a retry"
        );
    }

    /// Terminal states are terminal in both directions.
    #[tokio::test]
    async fn a_cancelled_recollection_cannot_be_completed() {
        let repo = MemorySpecimenRecollectionRepository::new();
        repo.open(request("RECOL-1", "REJ-1")).await.unwrap();
        let now = chrono::Utc::now();

        repo.cancel("RECOL-1", "Patient declined", now)
            .await
            .unwrap()
            .expect("cancellation succeeds");

        let completed = repo
            .complete("RECOL-1", "SPEC-REPLACEMENT", now)
            .await
            .unwrap();
        assert!(
            completed.is_none(),
            "a cancelled recollection must not be completable"
        );

        let stored = repo.get_by_id("RECOL-1").await.unwrap().unwrap();
        assert_eq!(stored.status, "cancelled");
        assert!(stored.replacement_specimen_id.is_none());
    }

    #[tokio::test]
    async fn a_completed_recollection_cannot_be_cancelled() {
        let repo = MemorySpecimenRecollectionRepository::new();
        repo.open(request("RECOL-1", "REJ-1")).await.unwrap();
        let now = chrono::Utc::now();
        repo.complete("RECOL-1", "SPEC-REPLACEMENT", now)
            .await
            .unwrap()
            .expect("completion succeeds");

        let cancelled = repo
            .cancel("RECOL-1", "changed my mind", now)
            .await
            .unwrap();
        assert!(
            cancelled.is_none(),
            "a completed recollection must not be cancellable"
        );
    }

    /// Cancelling frees the rejection for another attempt.
    ///
    /// A recollection that was abandoned -- the patient could not attend, the
    /// replacement was itself rejected -- must not permanently prevent asking
    /// again. This is why the PostgreSQL uniqueness is partial.
    #[tokio::test]
    async fn a_cancelled_request_does_not_block_a_second_attempt() {
        let repo = MemorySpecimenRecollectionRepository::new();
        repo.open(request("RECOL-1", "REJ-1")).await.unwrap();
        repo.cancel("RECOL-1", "Patient could not attend", chrono::Utc::now())
            .await
            .unwrap()
            .expect("cancellation succeeds");

        let retry = repo.open(request("RECOL-2", "REJ-1")).await.unwrap();
        assert!(
            retry.is_some(),
            "after cancellation the rejection must be requestable again"
        );
    }

    /// The whole history stays visible, including abandoned attempts.
    #[tokio::test]
    async fn the_lineage_retains_every_attempt() {
        let repo = MemorySpecimenRecollectionRepository::new();
        repo.open(request("RECOL-1", "REJ-1")).await.unwrap();
        repo.cancel("RECOL-1", "Patient could not attend", chrono::Utc::now())
            .await
            .unwrap();
        repo.open(request("RECOL-2", "REJ-1")).await.unwrap();

        let history = repo.list_for_rejection("REJ-1").await.unwrap();
        assert_eq!(
            history.len(),
            2,
            "an abandoned attempt is part of the record, not something to erase"
        );

        // And the open queue shows only what is still awaited.
        let open = repo.list_open().await.unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].id, "RECOL-2");
    }
}
