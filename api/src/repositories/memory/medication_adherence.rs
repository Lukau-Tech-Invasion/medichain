//! In-memory repositories for medication reminders and the adherence log.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

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
        items.sort_by_key(|b| std::cmp::Reverse(b.scheduled_time));
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
        items.sort_by_key(|b| std::cmp::Reverse(b.scheduled_time));
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
