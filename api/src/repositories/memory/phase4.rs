//! Phase 4-6 Memory Repositories for Specialty, Administrative & EMS
//!
//! In-memory HashMap implementations for Phase 4-6 entities.

use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

// =============================================================================
// PHASE 4: SPECIALTY ASSESSMENTS
// =============================================================================

/// Memory-based burn assessment repository
#[derive(Debug)]
pub struct MemoryBurnAssessmentRepository {
    data: RwLock<HashMap<String, BurnAssessmentEntity>>,
}

impl Default for MemoryBurnAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryBurnAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl BurnAssessmentRepository for MemoryBurnAssessmentRepository {
    async fn create(
        &self,
        assessment: BurnAssessmentEntity,
    ) -> RepositoryResult<BurnAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Burn assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<BurnAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Burn assessment {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BurnAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.assessment_datetime.cmp(&a.assessment_datetime));
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
        assessment: BurnAssessmentEntity,
    ) -> RepositoryResult<BurnAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Burn assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_severe_burns(
        &self,
        min_tbsa: Decimal,
    ) -> RepositoryResult<Vec<BurnAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.tbsa_percentage >= min_tbsa)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.tbsa_percentage.cmp(&a.tbsa_percentage));
        Ok(items)
    }
}

/// Memory-based psychiatric assessment repository
#[derive(Debug)]
pub struct MemoryPsychiatricAssessmentRepository {
    data: RwLock<HashMap<String, PsychiatricAssessmentEntity>>,
}

impl Default for MemoryPsychiatricAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryPsychiatricAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl PsychiatricAssessmentRepository for MemoryPsychiatricAssessmentRepository {
    async fn create(
        &self,
        assessment: PsychiatricAssessmentEntity,
    ) -> RepositoryResult<PsychiatricAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Psychiatric assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PsychiatricAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Psychiatric assessment {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PsychiatricAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.assessment_datetime.cmp(&a.assessment_datetime));
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
        assessment: PsychiatricAssessmentEntity,
    ) -> RepositoryResult<PsychiatricAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Psychiatric assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_high_risk(&self) -> RepositoryResult<Vec<PsychiatricAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let items: Vec<_> = data
            .values()
            .filter(|a| {
                a.suicidal_ideation
                    || a.homicidal_ideation
                    || a.risk_level == "high"
                    || a.risk_level == "critical"
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_risk_level(
        &self,
        risk_level: &str,
    ) -> RepositoryResult<Vec<PsychiatricAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|a| a.risk_level == risk_level)
            .cloned()
            .collect())
    }
}

/// Memory-based toxicology assessment repository
#[derive(Debug)]
pub struct MemoryToxicologyAssessmentRepository {
    data: RwLock<HashMap<String, ToxicologyAssessmentEntity>>,
}

impl Default for MemoryToxicologyAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryToxicologyAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl ToxicologyAssessmentRepository for MemoryToxicologyAssessmentRepository {
    async fn create(
        &self,
        assessment: ToxicologyAssessmentEntity,
    ) -> RepositoryResult<ToxicologyAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Toxicology assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ToxicologyAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Toxicology assessment {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ToxicologyAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.assessment_datetime.cmp(&a.assessment_datetime));
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
        assessment: ToxicologyAssessmentEntity,
    ) -> RepositoryResult<ToxicologyAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Toxicology assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_exposure_type(
        &self,
        exposure_type: &str,
    ) -> RepositoryResult<Vec<ToxicologyAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|a| a.exposure_type == exposure_type)
            .cloned()
            .collect())
    }
}

/// Memory-based pediatric assessment repository
#[derive(Debug)]
pub struct MemoryPediatricAssessmentRepository {
    data: RwLock<HashMap<String, PediatricAssessmentEntity>>,
}

impl Default for MemoryPediatricAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryPediatricAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl PediatricAssessmentRepository for MemoryPediatricAssessmentRepository {
    async fn create(
        &self,
        assessment: PediatricAssessmentEntity,
    ) -> RepositoryResult<PediatricAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Pediatric assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PediatricAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Pediatric assessment {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PediatricAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.assessment_datetime.cmp(&a.assessment_datetime));
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
        assessment: PediatricAssessmentEntity,
    ) -> RepositoryResult<PediatricAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Pediatric assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_cps_concerns(&self) -> RepositoryResult<Vec<PediatricAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|a| a.child_protective_concerns)
            .cloned()
            .collect())
    }
}

/// Memory-based obstetric emergency repository
#[derive(Debug)]
pub struct MemoryObstetricEmergencyRepository {
    data: RwLock<HashMap<String, ObstetricEmergencyEntity>>,
}

impl Default for MemoryObstetricEmergencyRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryObstetricEmergencyRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl ObstetricEmergencyRepository for MemoryObstetricEmergencyRepository {
    async fn create(
        &self,
        emergency: ObstetricEmergencyEntity,
    ) -> RepositoryResult<ObstetricEmergencyEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&emergency.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Obstetric emergency {} already exists",
                emergency.id
            )));
        }
        data.insert(emergency.id.clone(), emergency.clone());
        Ok(emergency)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ObstetricEmergencyEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Obstetric emergency {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ObstetricEmergencyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|e| e.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.assessment_datetime.cmp(&a.assessment_datetime));
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
        emergency: ObstetricEmergencyEntity,
    ) -> RepositoryResult<ObstetricEmergencyEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&emergency.id) {
            return Err(RepositoryError::NotFound(format!(
                "Obstetric emergency {} not found",
                emergency.id
            )));
        }
        data.insert(emergency.id.clone(), emergency.clone());
        Ok(emergency)
    }

    async fn get_active_emergencies(&self) -> RepositoryResult<Vec<ObstetricEmergencyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let items: Vec<_> = data
            .values()
            .filter(|e| {
                e.delivery_imminent || e.eclampsia || e.cord_prolapse || e.placental_abruption
            })
            .cloned()
            .collect();
        Ok(items)
    }
}

// =============================================================================
// PHASE 5: ADMINISTRATIVE & SCHEDULING
// =============================================================================

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
        items.sort_by(|a, b| b.scheduled_datetime.cmp(&a.scheduled_datetime));
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
        items.sort_by(|a, b| a.scheduled_datetime.cmp(&b.scheduled_datetime));
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
        items.sort_by(|a, b| b.scheduled_datetime.cmp(&a.scheduled_datetime));
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
        items.sort_by(|a, b| b.scheduled_datetime.cmp(&a.scheduled_datetime));
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
            .filter(|o| o.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.order_datetime.cmp(&a.order_datetime));
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
        items.sort_by(|a, b| priority_order(&a.priority).cmp(&priority_order(&b.priority)));
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

/// Memory-based discharge summary repository
#[derive(Debug)]
pub struct MemoryDischargeSummaryRepository {
    data: RwLock<HashMap<String, DischargeSummaryEntity>>,
}

impl Default for MemoryDischargeSummaryRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryDischargeSummaryRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl DischargeSummaryRepository for MemoryDischargeSummaryRepository {
    async fn create(
        &self,
        summary: DischargeSummaryEntity,
    ) -> RepositoryResult<DischargeSummaryEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&summary.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Discharge summary {} already exists",
                summary.id
            )));
        }
        data.insert(summary.id.clone(), summary.clone());
        Ok(summary)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DischargeSummaryEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Discharge summary {} not found", id)))
    }

    async fn get_by_encounter(
        &self,
        encounter_id: &str,
    ) -> RepositoryResult<Option<DischargeSummaryEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|s| s.encounter_id == encounter_id)
            .cloned())
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeSummaryEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|s| s.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.discharge_datetime.cmp(&a.discharge_datetime));
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
        summary: DischargeSummaryEntity,
    ) -> RepositoryResult<DischargeSummaryEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&summary.id) {
            return Err(RepositoryError::NotFound(format!(
                "Discharge summary {} not found",
                summary.id
            )));
        }
        data.insert(summary.id.clone(), summary.clone());
        Ok(summary)
    }
}

/// Memory-based discharge instructions repository
#[derive(Debug)]
pub struct MemoryDischargeInstructionsRepository {
    data: RwLock<HashMap<String, DischargeInstructionsEntity>>,
}

impl Default for MemoryDischargeInstructionsRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryDischargeInstructionsRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl DischargeInstructionsRepository for MemoryDischargeInstructionsRepository {
    async fn create(
        &self,
        instructions: DischargeInstructionsEntity,
    ) -> RepositoryResult<DischargeInstructionsEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&instructions.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Discharge instructions {} already exists",
                instructions.id
            )));
        }
        data.insert(instructions.id.clone(), instructions.clone());
        Ok(instructions)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DischargeInstructionsEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Discharge instructions {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeInstructionsEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|i| i.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.visit_date.cmp(&a.visit_date));
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

    async fn get_by_summary(
        &self,
        summary_id: &str,
    ) -> RepositoryResult<Option<DischargeInstructionsEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|i| i.discharge_summary_id.as_deref() == Some(summary_id))
            .cloned())
    }

    async fn update(
        &self,
        instructions: DischargeInstructionsEntity,
    ) -> RepositoryResult<DischargeInstructionsEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&instructions.id) {
            return Err(RepositoryError::NotFound(format!(
                "Discharge instructions {} not found",
                instructions.id
            )));
        }
        data.insert(instructions.id.clone(), instructions.clone());
        Ok(instructions)
    }
}

/// Memory-based AMA discharge repository
#[derive(Debug)]
pub struct MemoryAmaDischargeRepository {
    data: RwLock<HashMap<String, AmaDischargeEntity>>,
}

impl Default for MemoryAmaDischargeRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryAmaDischargeRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl AmaDischargeRepository for MemoryAmaDischargeRepository {
    async fn create(&self, discharge: AmaDischargeEntity) -> RepositoryResult<AmaDischargeEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&discharge.id) {
            return Err(RepositoryError::Duplicate(format!(
                "AMA discharge {} already exists",
                discharge.id
            )));
        }
        data.insert(discharge.id.clone(), discharge.clone());
        Ok(discharge)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AmaDischargeEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("AMA discharge {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AmaDischargeEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|d| d.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.discharge_datetime.cmp(&a.discharge_datetime));
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

    async fn get_by_encounter(
        &self,
        encounter_id: &str,
    ) -> RepositoryResult<Option<AmaDischargeEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|d| d.encounter_id == encounter_id)
            .cloned())
    }

    async fn update(&self, discharge: AmaDischargeEntity) -> RepositoryResult<AmaDischargeEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&discharge.id) {
            return Err(RepositoryError::NotFound(format!(
                "AMA discharge {} not found",
                discharge.id
            )));
        }
        data.insert(discharge.id.clone(), discharge.clone());
        Ok(discharge)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AmaDischargeEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<AmaDischargeEntity> = data.values().cloned().collect();
        items.sort_by(|a, b| b.discharge_datetime.cmp(&a.discharge_datetime));
        let total = items.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;
        let page: Vec<AmaDischargeEntity> =
            items.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(page, total, &pagination))
    }
}

/// Memory-based shift handoff repository
#[derive(Debug)]
pub struct MemoryShiftHandoffRepository {
    data: RwLock<HashMap<String, ShiftHandoffEntity>>,
}

impl Default for MemoryShiftHandoffRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryShiftHandoffRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl ShiftHandoffRepository for MemoryShiftHandoffRepository {
    async fn create(&self, handoff: ShiftHandoffEntity) -> RepositoryResult<ShiftHandoffEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&handoff.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Shift handoff {} already exists",
                handoff.id
            )));
        }
        data.insert(handoff.id.clone(), handoff.clone());
        Ok(handoff)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Shift handoff {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ShiftHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|h| h.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.handoff_datetime.cmp(&a.handoff_datetime));
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
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|h| {
                (h.outgoing_provider_id == provider_id || h.incoming_provider_id == provider_id)
                    && h.handoff_datetime.date_naive() == date
            })
            .cloned()
            .collect())
    }

    async fn acknowledge(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let handoff = data
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Shift handoff {} not found", id)))?;
        handoff.acknowledged_by_incoming = true;
        handoff.acknowledged_at = Some(Utc::now());
        Ok(handoff.clone())
    }

    async fn get_unacknowledged(
        &self,
        incoming_provider_id: &str,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|h| {
                h.incoming_provider_id == incoming_provider_id && !h.acknowledged_by_incoming
            })
            .cloned()
            .collect())
    }
}

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
        items.sort_by(|a, b| b.incident_datetime.cmp(&a.incident_datetime));
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
        items.sort_by(|a, b| b.incident_datetime.cmp(&a.incident_datetime));
        let total = items.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;
        let page: Vec<IncidentReportEntity> =
            items.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(page, total, &pagination))
    }
}

// =============================================================================
// PHASE 6: EMS & EXTERNAL
// =============================================================================

/// Memory-based EMS handoff repository
#[derive(Debug)]
pub struct MemoryEmsHandoffRepository {
    data: RwLock<HashMap<String, EmsHandoffEntity>>,
}

impl Default for MemoryEmsHandoffRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryEmsHandoffRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl EmsHandoffRepository for MemoryEmsHandoffRepository {
    async fn create(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&handoff.id) {
            return Err(RepositoryError::Duplicate(format!(
                "EMS handoff {} already exists",
                handoff.id
            )));
        }
        data.insert(handoff.id.clone(), handoff.clone());
        Ok(handoff)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<EmsHandoffEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("EMS handoff {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EmsHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|h| h.patient_id.as_deref() == Some(patient_id))
            .cloned()
            .collect();
        items.sort_by(|a, b| b.arrival_time.cmp(&a.arrival_time));
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

    async fn update(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&handoff.id) {
            return Err(RepositoryError::NotFound(format!(
                "EMS handoff {} not found",
                handoff.id
            )));
        }
        data.insert(handoff.id.clone(), handoff.clone());
        Ok(handoff)
    }

    async fn get_recent(&self, hours: i32) -> RepositoryResult<Vec<EmsHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let cutoff = Utc::now() - chrono::Duration::hours(hours as i64);
        let mut items: Vec<_> = data
            .values()
            .filter(|h| h.arrival_time >= cutoff)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.arrival_time.cmp(&a.arrival_time));
        Ok(items)
    }

    async fn get_alerts(&self) -> RepositoryResult<Vec<EmsHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|h| h.trauma_alert || h.stroke_alert || h.stemi_alert || h.sepsis_alert)
            .cloned()
            .collect())
    }
}

/// Memory-based MCI record repository
#[derive(Debug)]
pub struct MemoryMciRecordRepository {
    data: RwLock<HashMap<String, MciRecordEntity>>,
}

impl Default for MemoryMciRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryMciRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl MciRecordRepository for MemoryMciRecordRepository {
    async fn create(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "MCI record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MciRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("MCI record {} not found", id)))
    }

    async fn get_by_incident(&self, incident_id: &str) -> RepositoryResult<Vec<MciRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.incident_id == incident_id)
            .cloned()
            .collect())
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<MciRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.patient_id.as_deref() == Some(patient_id))
            .cloned()
            .collect())
    }

    async fn update(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "MCI record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_active_incidents(&self) -> RepositoryResult<Vec<MciRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        // Get unique active incidents (disposition is None or not ended)
        let items: Vec<_> = data
            .values()
            .filter(|r| r.disposition.is_none())
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_triage_category(
        &self,
        incident_id: &str,
        category: &str,
    ) -> RepositoryResult<Vec<MciRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.incident_id == incident_id && r.triage_category == category)
            .cloned()
            .collect())
    }
}

/// Memory-based chain of custody repository
#[derive(Debug)]
pub struct MemoryChainOfCustodyRepository {
    data: RwLock<HashMap<String, ChainOfCustodyEntity>>,
}

impl Default for MemoryChainOfCustodyRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryChainOfCustodyRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl ChainOfCustodyRepository for MemoryChainOfCustodyRepository {
    async fn create(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Chain of custody {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ChainOfCustodyEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Chain of custody {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.patient_id.as_deref() == Some(patient_id))
            .cloned()
            .collect())
    }

    async fn get_by_case(&self, case_number: &str) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.case_number.as_deref() == Some(case_number))
            .cloned()
            .collect())
    }

    async fn update(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Chain of custody {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn transfer(
        &self,
        id: &str,
        new_custodian_id: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<ChainOfCustodyEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let record = data.get_mut(id).ok_or_else(|| {
            RepositoryError::NotFound(format!("Chain of custody {} not found", id))
        })?;

        // Add transfer to history
        let transfer = serde_json::json!({
            "from": record.current_custodian_id,
            "to": new_custodian_id,
            "datetime": Utc::now().to_rfc3339(),
            "notes": notes
        });

        let mut transfers = if let Some(arr) = record.transfers.as_array() {
            arr.clone()
        } else {
            vec![]
        };
        transfers.push(transfer);
        record.transfers = serde_json::Value::Array(transfers);
        record.current_custodian_id = new_custodian_id.to_string();

        Ok(record.clone())
    }

    async fn get_by_custodian(
        &self,
        custodian_id: &str,
    ) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.current_custodian_id == custodian_id)
            .cloned()
            .collect())
    }

    async fn list_all(&self) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_burn_assessment_crud() {
        let repo = MemoryBurnAssessmentRepository::new();
        let assessment = BurnAssessmentEntity {
            id: "burn-001".to_string(),
            patient_id: "patient-001".to_string(),
            assessed_by: "doctor-001".to_string(),
            tbsa_percentage: Decimal::new(25, 0),
            ..Default::default()
        };

        let created = repo.create(assessment).await.unwrap();
        assert_eq!(created.id, "burn-001");

        let fetched = repo.get_by_id("burn-001").await.unwrap();
        assert_eq!(fetched.patient_id, "patient-001");
    }

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

    #[tokio::test]
    async fn test_chain_of_custody_transfer() {
        let repo = MemoryChainOfCustodyRepository::new();
        let record = ChainOfCustodyEntity {
            id: "coc-001".to_string(),
            current_custodian_id: "nurse-001".to_string(),
            transfers: serde_json::json!([]),
            ..Default::default()
        };

        repo.create(record).await.unwrap();
        let transferred = repo
            .transfer("coc-001", "detective-001", Some("Evidence transfer"))
            .await
            .unwrap();
        assert_eq!(transferred.current_custodian_id, "detective-001");
        assert!(!transferred.transfers.as_array().unwrap().is_empty());
    }
}
