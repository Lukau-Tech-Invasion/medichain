//! In-memory repositories for radiology orders and reports, pathology reports.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

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
        items.sort_by_key(|b| std::cmp::Reverse(b.report_datetime));
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
        items.sort_by_key(|b| std::cmp::Reverse(b.report_date));
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
