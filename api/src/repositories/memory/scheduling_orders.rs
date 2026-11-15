//! In-memory repositories for appointments and physician orders.

use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// Memory-based appointment repository
#[derive(Debug)]
pub struct MemoryAppointmentRepository {
    data: RwLock<HashMap<String, AppointmentEntity>>,
}

impl Default for MemoryAppointmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryAppointmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl AppointmentRepository for MemoryAppointmentRepository {
    async fn create(&self, appointment: AppointmentEntity) -> RepositoryResult<AppointmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&appointment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Appointment {} already exists",
                appointment.id
            )));
        }
        data.insert(appointment.id.clone(), appointment.clone());
        Ok(appointment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AppointmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Appointment {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.scheduled_datetime));
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
        date: NaiveDate,
    ) -> RepositoryResult<Vec<AppointmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.provider_id == provider_id && a.scheduled_datetime.date_naive() == date)
            .cloned()
            .collect();
        items.sort_by_key(|a| a.scheduled_datetime);
        Ok(items)
    }

    async fn update(&self, appointment: AppointmentEntity) -> RepositoryResult<AppointmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&appointment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Appointment {} not found",
                appointment.id
            )));
        }
        data.insert(appointment.id.clone(), appointment.clone());
        Ok(appointment)
    }

    async fn cancel(
        &self,
        id: &str,
        reason: &str,
        cancelled_by: &str,
    ) -> RepositoryResult<AppointmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let appointment = data
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Appointment {} not found", id)))?;
        appointment.status = "cancelled".to_string();
        appointment.cancellation_reason = Some(reason.to_string());
        appointment.cancelled_by = Some(cancelled_by.to_string());
        appointment.cancelled_at = Some(Utc::now());
        Ok(appointment.clone())
    }

    async fn get_by_status(
        &self,
        status: &str,
        date: NaiveDate,
    ) -> RepositoryResult<Vec<AppointmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let items: Vec<_> = data
            .values()
            .filter(|a| a.status == status && a.scheduled_datetime.date_naive() == date)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data.values().cloned().collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.scheduled_datetime));
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

    async fn get_by_provider_all(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.provider_id == provider_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.scheduled_datetime));
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
}

/// Memory-based physician order repository
#[derive(Debug)]
pub struct MemoryPhysicianOrderRepository {
    data: RwLock<HashMap<String, PhysicianOrderEntity>>,
}

impl Default for MemoryPhysicianOrderRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryPhysicianOrderRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl PhysicianOrderRepository for MemoryPhysicianOrderRepository {
    async fn create(&self, order: PhysicianOrderEntity) -> RepositoryResult<PhysicianOrderEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&order.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Physician order {} already exists",
                order.id
            )));
        }
        data.insert(order.id.clone(), order.clone());
        Ok(order)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PhysicianOrderEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Physician order {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PhysicianOrderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|o| patient_id == "all" || o.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.order_datetime));
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

    async fn update(&self, order: PhysicianOrderEntity) -> RepositoryResult<PhysicianOrderEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&order.id) {
            return Err(RepositoryError::NotFound(format!(
                "Physician order {} not found",
                order.id
            )));
        }
        data.insert(order.id.clone(), order.clone());
        Ok(order)
    }

    async fn get_pending_orders(&self) -> RepositoryResult<Vec<PhysicianOrderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|o| o.status == "pending" || o.status == "active")
            .cloned()
            .collect();
        let priority_order = |p: &str| match p {
            "stat" => 1,
            "asap" => 2,
            "urgent" => 3,
            "routine" => 4,
            _ => 5,
        };
        items.sort_by_key(|a| priority_order(&a.priority));
        Ok(items)
    }

    async fn get_by_type(
        &self,
        order_type: &str,
        patient_id: &str,
    ) -> RepositoryResult<Vec<PhysicianOrderEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|o| o.order_type == order_type && o.patient_id == patient_id)
            .cloned()
            .collect())
    }

    async fn discontinue(
        &self,
        id: &str,
        reason: &str,
        discontinued_by: &str,
    ) -> RepositoryResult<PhysicianOrderEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let order = data.get_mut(id).ok_or_else(|| {
            RepositoryError::NotFound(format!("Physician order {} not found", id))
        })?;
        order.status = "discontinued".to_string();
        order.discontinue_reason = Some(reason.to_string());
        order.discontinued_by = Some(discontinued_by.to_string());
        order.discontinued_at = Some(Utc::now());
        Ok(order.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_appointment_cancel() {
        let repo = MemoryAppointmentRepository::new();
        let appointment = AppointmentEntity {
            id: "apt-001".to_string(),
            patient_id: "patient-001".to_string(),
            provider_id: "doctor-001".to_string(),
            status: "scheduled".to_string(),
            ..Default::default()
        };

        repo.create(appointment).await.unwrap();
        let cancelled = repo
            .cancel("apt-001", "Patient request", "admin-001")
            .await
            .unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert!(cancelled.cancellation_reason.is_some());
    }
}
