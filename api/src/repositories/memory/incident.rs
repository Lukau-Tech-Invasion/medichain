//! In-memory repositories for incident reports.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// Memory-based incident report repository
#[derive(Debug)]
pub struct MemoryIncidentReportRepository {
    data: RwLock<HashMap<String, IncidentReportEntity>>,
}

impl Default for MemoryIncidentReportRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryIncidentReportRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl IncidentReportRepository for MemoryIncidentReportRepository {
    async fn create(&self, report: IncidentReportEntity) -> RepositoryResult<IncidentReportEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&report.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Incident report {} already exists",
                report.id
            )));
        }
        data.insert(report.id.clone(), report.clone());
        Ok(report)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IncidentReportEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Incident report {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IncidentReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id.as_deref() == Some(patient_id))
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.incident_datetime));
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

    async fn update(&self, report: IncidentReportEntity) -> RepositoryResult<IncidentReportEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&report.id) {
            return Err(RepositoryError::NotFound(format!(
                "Incident report {} not found",
                report.id
            )));
        }
        data.insert(report.id.clone(), report.clone());
        Ok(report)
    }

    async fn get_open_investigations(&self) -> RepositoryResult<Vec<IncidentReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| {
                r.investigation_status.as_deref() == Some("open")
                    || r.investigation_status.as_deref() == Some("in_progress")
            })
            .cloned()
            .collect())
    }

    async fn get_by_severity(&self, severity: &str) -> RepositoryResult<Vec<IncidentReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.severity == severity)
            .cloned()
            .collect())
    }

    async fn get_by_type(
        &self,
        incident_type: &str,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<IncidentReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let items: Vec<_> = data
            .values()
            .filter(|r| {
                if r.incident_type != incident_type {
                    return false;
                }
                if let Some(ref range) = date_range {
                    if let Some(ref from) = range.from {
                        if r.incident_datetime < *from {
                            return false;
                        }
                    }
                    if let Some(ref to) = range.to {
                        if r.incident_datetime > *to {
                            return false;
                        }
                    }
                }
                true
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IncidentReportEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<IncidentReportEntity> = data.values().cloned().collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.incident_datetime));
        let total = items.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;
        let page: Vec<IncidentReportEntity> = items.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(page, total, &pagination))
    }
}
