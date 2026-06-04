//! Phase 3 Memory Repositories for Lab, Surgical, Radiology, Blood Bank, Pharmacy
//!
//! In-memory HashMap implementations for Phase 3 entities.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

// =============================================================================
// LAB & DIAGNOSTICS REPOSITORIES
// =============================================================================

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
        items.sort_by(|a, b| b.order_date.cmp(&a.order_date));
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
        items.sort_by(|a, b| b.order_date.cmp(&a.order_date));
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

/// Memory-based lab panel repository
#[derive(Debug)]
pub struct MemoryLabPanelRepository {
    data: RwLock<HashMap<String, LabPanelEntity>>,
}

impl Default for MemoryLabPanelRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryLabPanelRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl LabPanelRepository for MemoryLabPanelRepository {
    async fn create(&self, panel: LabPanelEntity) -> RepositoryResult<LabPanelEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&panel.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Lab panel {} already exists",
                panel.id
            )));
        }
        data.insert(panel.id.clone(), panel.clone());
        Ok(panel)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabPanelEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Lab panel {} not found", id)))
    }

    async fn get_by_submission(
        &self,
        submission_id: &str,
    ) -> RepositoryResult<Vec<LabPanelEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|p| p.submission_id == submission_id)
            .cloned()
            .collect())
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabPanelEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|p| p.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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

    async fn update(&self, panel: LabPanelEntity) -> RepositoryResult<LabPanelEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&panel.id) {
            return Err(RepositoryError::NotFound(format!(
                "Lab panel {} not found",
                panel.id
            )));
        }
        data.insert(panel.id.clone(), panel.clone());
        Ok(panel)
    }

    async fn get_abnormal_results(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<LabPanelEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|p| p.patient_id == patient_id && p.abnormal_flags.is_some())
            .cloned()
            .collect())
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
        items.sort_by(|a, b| b.performed_at.cmp(&a.performed_at));
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
        items.sort_by(|a, b| b.performed_at.cmp(&a.performed_at));
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
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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

    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
        action_taken: &str,
    ) -> RepositoryResult<CriticalValueEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let value = data
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Critical value {} not found", id)))?;
        value.acknowledged_at = Some(Utc::now());
        value.acknowledged_by = Some(acknowledged_by.to_string());
        value.action_taken = Some(action_taken.to_string());
        Ok(value.clone())
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

/// Memory-based lab trend repository
#[derive(Debug)]
pub struct MemoryLabTrendRepository {
    data: RwLock<HashMap<String, LabTrendEntity>>,
}

impl Default for MemoryLabTrendRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryLabTrendRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl LabTrendRepository for MemoryLabTrendRepository {
    async fn create(&self, trend: LabTrendEntity) -> RepositoryResult<LabTrendEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&trend.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Lab trend {} already exists",
                trend.id
            )));
        }
        data.insert(trend.id.clone(), trend.clone());
        Ok(trend)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabTrendEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Lab trend {} not found", id)))
    }

    async fn get_by_patient_test(
        &self,
        patient_id: &str,
        test_code: &str,
    ) -> RepositoryResult<Option<LabTrendEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|t| t.patient_id == patient_id && t.test_code == test_code)
            .cloned())
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<LabTrendEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|t| t.patient_id == patient_id)
            .cloned()
            .collect())
    }

    async fn update(&self, trend: LabTrendEntity) -> RepositoryResult<LabTrendEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&trend.id) {
            return Err(RepositoryError::NotFound(format!(
                "Lab trend {} not found",
                trend.id
            )));
        }
        data.insert(trend.id.clone(), trend.clone());
        Ok(trend)
    }
}

// =============================================================================
// SURGICAL & PROCEDURES REPOSITORIES
// =============================================================================

/// Memory-based pre-op assessment repository
#[derive(Debug)]
pub struct MemoryPreOpAssessmentRepository {
    data: RwLock<HashMap<String, PreOpAssessmentEntity>>,
}

impl Default for MemoryPreOpAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryPreOpAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl PreOpAssessmentRepository for MemoryPreOpAssessmentRepository {
    async fn create(
        &self,
        assessment: PreOpAssessmentEntity,
    ) -> RepositoryResult<PreOpAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Pre-op assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PreOpAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Pre-op assessment {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PreOpAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.assessed_at.cmp(&a.assessed_at));
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

    async fn get_by_surgeon(
        &self,
        surgeon_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PreOpAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.surgeon_id == surgeon_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.assessed_at.cmp(&a.assessed_at));
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
        assessment: PreOpAssessmentEntity,
    ) -> RepositoryResult<PreOpAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Pre-op assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_scheduled(
        &self,
        date_range: DateRange,
    ) -> RepositoryResult<Vec<PreOpAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| {
                if let Some(scheduled) = a.scheduled_date {
                    if let Some(from) = date_range.from {
                        if scheduled < from {
                            return false;
                        }
                    }
                    if let Some(to) = date_range.to {
                        if scheduled > to {
                            return false;
                        }
                    }
                    true
                } else {
                    false
                }
            })
            .cloned()
            .collect();
        items.sort_by(|a, b| a.scheduled_date.cmp(&b.scheduled_date));
        Ok(items)
    }
}

/// Memory-based operative note repository
#[derive(Debug)]
pub struct MemoryOperativeNoteRepository {
    data: RwLock<HashMap<String, OperativeNoteEntity>>,
}

impl Default for MemoryOperativeNoteRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryOperativeNoteRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl OperativeNoteRepository for MemoryOperativeNoteRepository {
    async fn create(&self, note: OperativeNoteEntity) -> RepositoryResult<OperativeNoteEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&note.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Operative note {} already exists",
                note.id
            )));
        }
        data.insert(note.id.clone(), note.clone());
        Ok(note)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<OperativeNoteEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Operative note {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<OperativeNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|n| n.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.start_time.cmp(&a.start_time));
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

    async fn get_by_surgeon(
        &self,
        surgeon_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<OperativeNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|n| n.surgeon_id == surgeon_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.start_time.cmp(&a.start_time));
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

    async fn update(&self, note: OperativeNoteEntity) -> RepositoryResult<OperativeNoteEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&note.id) {
            return Err(RepositoryError::NotFound(format!(
                "Operative note {} not found",
                note.id
            )));
        }
        data.insert(note.id.clone(), note.clone());
        Ok(note)
    }
}

/// Memory-based post-op note repository
#[derive(Debug)]
pub struct MemoryPostOpNoteRepository {
    data: RwLock<HashMap<String, PostOpNoteEntity>>,
}

impl Default for MemoryPostOpNoteRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryPostOpNoteRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl PostOpNoteRepository for MemoryPostOpNoteRepository {
    async fn create(&self, note: PostOpNoteEntity) -> RepositoryResult<PostOpNoteEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&note.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Post-op note {} already exists",
                note.id
            )));
        }
        data.insert(note.id.clone(), note.clone());
        Ok(note)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PostOpNoteEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Post-op note {} not found", id)))
    }

    async fn get_by_operative_note(
        &self,
        operative_note_id: &str,
    ) -> RepositoryResult<Vec<PostOpNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|n| n.operative_note_id == operative_note_id)
            .cloned()
            .collect();
        items.sort_by_key(|n| n.post_op_day);
        Ok(items)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PostOpNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|n| n.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.note_date.cmp(&a.note_date));
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

    async fn update(&self, note: PostOpNoteEntity) -> RepositoryResult<PostOpNoteEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&note.id) {
            return Err(RepositoryError::NotFound(format!(
                "Post-op note {} not found",
                note.id
            )));
        }
        data.insert(note.id.clone(), note.clone());
        Ok(note)
    }
}

/// Memory-based anesthesia record repository
#[derive(Debug)]
pub struct MemoryAnesthesiaRecordRepository {
    data: RwLock<HashMap<String, AnesthesiaRecordEntity>>,
}

impl Default for MemoryAnesthesiaRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryAnesthesiaRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl AnesthesiaRecordRepository for MemoryAnesthesiaRecordRepository {
    async fn create(
        &self,
        record: AnesthesiaRecordEntity,
    ) -> RepositoryResult<AnesthesiaRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Anesthesia record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AnesthesiaRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Anesthesia record {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AnesthesiaRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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
        anesthesiologist_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AnesthesiaRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.anesthesiologist_id == anesthesiologist_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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
        record: AnesthesiaRecordEntity,
    ) -> RepositoryResult<AnesthesiaRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Anesthesia record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<AnesthesiaRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based intubation record repository
#[derive(Debug)]
pub struct MemoryIntubationRecordRepository {
    data: RwLock<HashMap<String, IntubationRecordEntity>>,
}

impl Default for MemoryIntubationRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryIntubationRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl IntubationRecordRepository for MemoryIntubationRecordRepository {
    async fn create(
        &self,
        record: IntubationRecordEntity,
    ) -> RepositoryResult<IntubationRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Intubation record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IntubationRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Intubation record {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IntubationRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.performed_at.cmp(&a.performed_at));
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

    async fn get_difficult_airways(&self) -> RepositoryResult<Vec<IntubationRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.difficult_airway)
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        record: IntubationRecordEntity,
    ) -> RepositoryResult<IntubationRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Intubation record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }
}

/// Memory-based laceration repair repository
#[derive(Debug)]
pub struct MemoryLacerationRepairRepository {
    data: RwLock<HashMap<String, LacerationRepairEntity>>,
}

impl Default for MemoryLacerationRepairRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryLacerationRepairRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl LacerationRepairRepository for MemoryLacerationRepairRepository {
    async fn create(
        &self,
        repair: LacerationRepairEntity,
    ) -> RepositoryResult<LacerationRepairEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&repair.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Laceration repair {} already exists",
                repair.id
            )));
        }
        data.insert(repair.id.clone(), repair.clone());
        Ok(repair)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LacerationRepairEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Laceration repair {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LacerationRepairEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.performed_at.cmp(&a.performed_at));
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

    async fn get_pending_followups(&self) -> RepositoryResult<Vec<LacerationRepairEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let today = Utc::now().date_naive();
        Ok(data
            .values()
            .filter(|r| r.follow_up_date.map(|d| d >= today).unwrap_or(false))
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        repair: LacerationRepairEntity,
    ) -> RepositoryResult<LacerationRepairEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&repair.id) {
            return Err(RepositoryError::NotFound(format!(
                "Laceration repair {} not found",
                repair.id
            )));
        }
        data.insert(repair.id.clone(), repair.clone());
        Ok(repair)
    }
}

/// Memory-based splint/cast record repository
#[derive(Debug)]
pub struct MemorySplintCastRecordRepository {
    data: RwLock<HashMap<String, SplintCastRecordEntity>>,
}

impl Default for MemorySplintCastRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemorySplintCastRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl SplintCastRecordRepository for MemorySplintCastRecordRepository {
    async fn create(
        &self,
        record: SplintCastRecordEntity,
    ) -> RepositoryResult<SplintCastRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Splint/cast record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SplintCastRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Splint/cast record {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SplintCastRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.applied_at.cmp(&a.applied_at));
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

    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<SplintCastRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.patient_id == patient_id && r.removal_date.is_none())
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        record: SplintCastRecordEntity,
    ) -> RepositoryResult<SplintCastRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Splint/cast record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }
}

// =============================================================================
// RADIOLOGY & IMAGING REPOSITORIES
// =============================================================================

/// Memory-based radiology order repository
#[derive(Debug)]
pub struct MemoryRadiologyOrderRepository {
    data: RwLock<HashMap<String, RadiologyOrderEntity>>,
}

impl Default for MemoryRadiologyOrderRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryRadiologyOrderRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl RadiologyOrderRepository for MemoryRadiologyOrderRepository {
    async fn create(&self, order: RadiologyOrderEntity) -> RepositoryResult<RadiologyOrderEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&order.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Radiology order {} already exists",
                order.id
            )));
        }
        data.insert(order.id.clone(), order.clone());
        Ok(order)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RadiologyOrderEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Radiology order {} not found", id)))
    }

    async fn get_by_accession(
        &self,
        accession_number: &str,
    ) -> RepositoryResult<Option<RadiologyOrderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|o| o.accession_number.as_deref() == Some(accession_number))
            .cloned())
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RadiologyOrderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|o| o.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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

    async fn update(&self, order: RadiologyOrderEntity) -> RepositoryResult<RadiologyOrderEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&order.id) {
            return Err(RepositoryError::NotFound(format!(
                "Radiology order {} not found",
                order.id
            )));
        }
        data.insert(order.id.clone(), order.clone());
        Ok(order)
    }

    async fn get_pending_by_modality(
        &self,
        modality: &str,
    ) -> RepositoryResult<Vec<RadiologyOrderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|o| {
                o.modality == modality
                    && (o.status == "ordered"
                        || o.status == "scheduled"
                        || o.status == "in_progress")
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
            priority_order(&a.priority).cmp(&priority_order(&b.priority))
        });
        Ok(items)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<RadiologyOrderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based radiology report repository
#[derive(Debug)]
pub struct MemoryRadiologyReportRepository {
    data: RwLock<HashMap<String, RadiologyReportEntity>>,
}

impl Default for MemoryRadiologyReportRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryRadiologyReportRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl RadiologyReportRepository for MemoryRadiologyReportRepository {
    async fn create(
        &self,
        report: RadiologyReportEntity,
    ) -> RepositoryResult<RadiologyReportEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&report.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Radiology report {} already exists",
                report.id
            )));
        }
        data.insert(report.id.clone(), report.clone());
        Ok(report)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RadiologyReportEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Radiology report {} not found", id)))
    }

    async fn get_by_order(
        &self,
        order_id: &str,
    ) -> RepositoryResult<Option<RadiologyReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().find(|r| r.order_id == order_id).cloned())
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RadiologyReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.report_datetime.cmp(&a.report_datetime));
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
        report: RadiologyReportEntity,
    ) -> RepositoryResult<RadiologyReportEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&report.id) {
            return Err(RepositoryError::NotFound(format!(
                "Radiology report {} not found",
                report.id
            )));
        }
        data.insert(report.id.clone(), report.clone());
        Ok(report)
    }

    async fn get_critical_findings(&self) -> RepositoryResult<Vec<RadiologyReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.critical_finding && !r.critical_finding_communicated.unwrap_or(false))
            .cloned()
            .collect())
    }

    async fn list_all(&self) -> RepositoryResult<Vec<RadiologyReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based pathology report repository
#[derive(Debug)]
pub struct MemoryPathologyReportRepository {
    data: RwLock<HashMap<String, PathologyReportEntity>>,
}

impl Default for MemoryPathologyReportRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryPathologyReportRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl PathologyReportRepository for MemoryPathologyReportRepository {
    async fn create(
        &self,
        report: PathologyReportEntity,
    ) -> RepositoryResult<PathologyReportEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&report.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Pathology report {} already exists",
                report.id
            )));
        }
        data.insert(report.id.clone(), report.clone());
        Ok(report)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PathologyReportEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Pathology report {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PathologyReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.report_date.cmp(&a.report_date));
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

    async fn get_by_specimen(
        &self,
        specimen_id: &str,
    ) -> RepositoryResult<Option<PathologyReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|r| r.specimen_id.as_deref() == Some(specimen_id))
            .cloned())
    }

    async fn update(
        &self,
        report: PathologyReportEntity,
    ) -> RepositoryResult<PathologyReportEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&report.id) {
            return Err(RepositoryError::NotFound(format!(
                "Pathology report {} not found",
                report.id
            )));
        }
        data.insert(report.id.clone(), report.clone());
        Ok(report)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<PathologyReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

// =============================================================================
// BLOOD BANK REPOSITORIES
// =============================================================================

/// Memory-based blood type screen repository
#[derive(Debug)]
pub struct MemoryBloodTypeScreenRepository {
    data: RwLock<HashMap<String, BloodTypeScreenEntity>>,
}

impl Default for MemoryBloodTypeScreenRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryBloodTypeScreenRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl BloodTypeScreenRepository for MemoryBloodTypeScreenRepository {
    async fn create(
        &self,
        screen: BloodTypeScreenEntity,
    ) -> RepositoryResult<BloodTypeScreenEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&screen.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Blood type screen {} already exists",
                screen.id
            )));
        }
        data.insert(screen.id.clone(), screen.clone());
        Ok(screen)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<BloodTypeScreenEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Blood type screen {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BloodTypeScreenEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|s| s.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.performed_at.cmp(&a.performed_at));
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

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<BloodTypeScreenEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|s| s.patient_id == patient_id)
            .max_by_key(|s| s.performed_at)
            .cloned())
    }

    async fn update(
        &self,
        screen: BloodTypeScreenEntity,
    ) -> RepositoryResult<BloodTypeScreenEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&screen.id) {
            return Err(RepositoryError::NotFound(format!(
                "Blood type screen {} not found",
                screen.id
            )));
        }
        data.insert(screen.id.clone(), screen.clone());
        Ok(screen)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<BloodTypeScreenEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based crossmatch record repository
#[derive(Debug)]
pub struct MemoryCrossmatchRecordRepository {
    data: RwLock<HashMap<String, CrossmatchRecordEntity>>,
}

impl Default for MemoryCrossmatchRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryCrossmatchRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl CrossmatchRecordRepository for MemoryCrossmatchRecordRepository {
    async fn create(
        &self,
        record: CrossmatchRecordEntity,
    ) -> RepositoryResult<CrossmatchRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Crossmatch record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CrossmatchRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Crossmatch record {} not found", id)))
    }

    async fn get_by_unit(
        &self,
        unit_number: &str,
    ) -> RepositoryResult<Option<CrossmatchRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|r| r.unit_number == unit_number)
            .cloned())
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CrossmatchRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.performed_at.cmp(&a.performed_at));
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
        record: CrossmatchRecordEntity,
    ) -> RepositoryResult<CrossmatchRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Crossmatch record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_reserved_units(&self) -> RepositoryResult<Vec<CrossmatchRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let now = Utc::now();
        Ok(data
            .values()
            .filter(|r| r.reserved_until.map(|t| t > now).unwrap_or(false) && r.issued_at.is_none())
            .cloned()
            .collect())
    }

    async fn list_all(&self) -> RepositoryResult<Vec<CrossmatchRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based transfusion record repository
#[derive(Debug)]
pub struct MemoryTransfusionRecordRepository {
    data: RwLock<HashMap<String, TransfusionRecordEntity>>,
}

impl Default for MemoryTransfusionRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryTransfusionRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl TransfusionRecordRepository for MemoryTransfusionRecordRepository {
    async fn create(
        &self,
        record: TransfusionRecordEntity,
    ) -> RepositoryResult<TransfusionRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Transfusion record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TransfusionRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Transfusion record {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TransfusionRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.start_time.cmp(&a.start_time));
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
        record: TransfusionRecordEntity,
    ) -> RepositoryResult<TransfusionRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Transfusion record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_reactions(
        &self,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<TransfusionRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| {
                if !r.reaction_occurred {
                    return false;
                }
                if let Some(ref range) = date_range {
                    if let Some(from) = range.from {
                        if r.start_time < from {
                            return false;
                        }
                    }
                    if let Some(to) = range.to {
                        if r.start_time > to {
                            return false;
                        }
                    }
                }
                true
            })
            .cloned()
            .collect();
        items.sort_by(|a, b| b.start_time.cmp(&a.start_time));
        Ok(items)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<TransfusionRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

// =============================================================================
// PHARMACY & MEDICATIONS REPOSITORIES
// =============================================================================

/// Memory-based e-prescription repository
#[derive(Debug)]
pub struct MemoryEPrescriptionRepository {
    data: RwLock<HashMap<String, EPrescriptionEntity>>,
}

impl Default for MemoryEPrescriptionRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryEPrescriptionRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl EPrescriptionRepository for MemoryEPrescriptionRepository {
    async fn create(
        &self,
        prescription: EPrescriptionEntity,
    ) -> RepositoryResult<EPrescriptionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&prescription.id) {
            return Err(RepositoryError::Duplicate(format!(
                "E-prescription {} already exists",
                prescription.id
            )));
        }
        data.insert(prescription.id.clone(), prescription.clone());
        Ok(prescription)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<EPrescriptionEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("E-prescription {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|p| p.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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

    async fn get_by_prescriber(
        &self,
        prescriber_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|p| p.prescriber_id == prescriber_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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
        prescription: EPrescriptionEntity,
    ) -> RepositoryResult<EPrescriptionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&prescription.id) {
            return Err(RepositoryError::NotFound(format!(
                "E-prescription {} not found",
                prescription.id
            )));
        }
        data.insert(prescription.id.clone(), prescription.clone());
        Ok(prescription)
    }

    async fn get_active_controlled(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<EPrescriptionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|p| {
                p.patient_id == patient_id
                    && p.is_controlled
                    && (p.status == "pending" || p.status == "sent" || p.status == "filled")
            })
            .cloned()
            .collect())
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<EPrescriptionEntity> = data.values().cloned().collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = items.len() as u64;
        let paged: Vec<_> = items
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(paged, total, &pagination))
    }
}

/// Memory-based drug interaction repository
#[derive(Debug)]
pub struct MemoryDrugInteractionRepository {
    data: RwLock<HashMap<String, DrugInteractionEntity>>,
}

impl Default for MemoryDrugInteractionRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryDrugInteractionRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl DrugInteractionRepository for MemoryDrugInteractionRepository {
    async fn create(
        &self,
        interaction: DrugInteractionEntity,
    ) -> RepositoryResult<DrugInteractionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&interaction.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Drug interaction {} already exists",
                interaction.id
            )));
        }
        data.insert(interaction.id.clone(), interaction.clone());
        Ok(interaction)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DrugInteractionEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Drug interaction {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<DrugInteractionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|i| i.patient_id == patient_id)
            .cloned()
            .collect())
    }

    async fn get_unacknowledged(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<DrugInteractionEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|i| i.patient_id == patient_id && !i.acknowledged)
            .cloned()
            .collect();
        items.sort_by(|a, b| {
            let severity_order = |s: &str| match s {
                "contraindicated" => 1,
                "major" => 2,
                "moderate" => 3,
                _ => 4,
            };
            severity_order(&a.severity).cmp(&severity_order(&b.severity))
        });
        Ok(items)
    }

    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
        override_reason: Option<&str>,
    ) -> RepositoryResult<DrugInteractionEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let interaction = data.get_mut(id).ok_or_else(|| {
            RepositoryError::NotFound(format!("Drug interaction {} not found", id))
        })?;
        interaction.acknowledged = true;
        interaction.acknowledged_by = Some(acknowledged_by.to_string());
        interaction.acknowledged_at = Some(Utc::now());
        interaction.override_reason = override_reason.map(|s| s.to_string());
        Ok(interaction.clone())
    }
}

/// Memory-based medication reminder repository
#[derive(Debug)]
pub struct MemoryMedicationReminderRepository {
    data: RwLock<HashMap<String, MedicationReminderEntity>>,
}

impl Default for MemoryMedicationReminderRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryMedicationReminderRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl MedicationReminderRepository for MemoryMedicationReminderRepository {
    async fn create(
        &self,
        reminder: MedicationReminderEntity,
    ) -> RepositoryResult<MedicationReminderEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&reminder.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Medication reminder {} already exists",
                reminder.id
            )));
        }
        data.insert(reminder.id.clone(), reminder.clone());
        Ok(reminder)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicationReminderEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Medication reminder {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<MedicationReminderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect())
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<MedicationReminderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.patient_id == patient_id && r.is_active)
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        reminder: MedicationReminderEntity,
    ) -> RepositoryResult<MedicationReminderEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&reminder.id) {
            return Err(RepositoryError::NotFound(format!(
                "Medication reminder {} not found",
                reminder.id
            )));
        }
        data.insert(reminder.id.clone(), reminder.clone());
        Ok(reminder)
    }

    async fn list_all_active(&self) -> RepositoryResult<Vec<MedicationReminderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().filter(|r| r.is_active).cloned().collect())
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<()> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let reminder = data.get_mut(id).ok_or_else(|| {
            RepositoryError::NotFound(format!("Medication reminder {} not found", id))
        })?;
        reminder.is_active = false;
        Ok(())
    }
}

/// Memory-based adherence log repository
#[derive(Debug)]
pub struct MemoryAdherenceLogRepository {
    data: RwLock<HashMap<String, AdherenceLogEntity>>,
}

impl Default for MemoryAdherenceLogRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryAdherenceLogRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl AdherenceLogRepository for MemoryAdherenceLogRepository {
    async fn create(&self, log: AdherenceLogEntity) -> RepositoryResult<AdherenceLogEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&log.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Adherence log {} already exists",
                log.id
            )));
        }
        data.insert(log.id.clone(), log.clone());
        Ok(log)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AdherenceLogEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Adherence log {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AdherenceLogEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|l| {
                if l.patient_id != patient_id {
                    return false;
                }
                if let Some(ref range) = date_range {
                    if let Some(from) = range.from {
                        if l.scheduled_time < from {
                            return false;
                        }
                    }
                    if let Some(to) = range.to {
                        if l.scheduled_time > to {
                            return false;
                        }
                    }
                }
                true
            })
            .cloned()
            .collect();
        items.sort_by(|a, b| b.scheduled_time.cmp(&a.scheduled_time));
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

    async fn get_by_reminder(
        &self,
        reminder_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AdherenceLogEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|l| l.reminder_id.as_deref() == Some(reminder_id))
            .cloned()
            .collect();
        items.sort_by(|a, b| b.scheduled_time.cmp(&a.scheduled_time));
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

    async fn get_adherence_rate(
        &self,
        patient_id: &str,
        medication_name: &str,
        days: i32,
    ) -> RepositoryResult<f64> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let cutoff = Utc::now() - chrono::Duration::days(days as i64);
        let logs: Vec<_> = data
            .values()
            .filter(|l| {
                l.patient_id == patient_id
                    && l.medication_name == medication_name
                    && l.scheduled_time >= cutoff
            })
            .collect();

        if logs.is_empty() {
            return Ok(0.0);
        }

        let taken_count = logs.iter().filter(|l| l.action_taken == "taken").count();
        Ok((taken_count as f64 / logs.len() as f64) * 100.0)
    }
}
