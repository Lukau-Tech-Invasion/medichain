//! In-memory repositories for specialty assessments: burn, psychiatric, toxicology, paediatric, obstetric.

use async_trait::async_trait;
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

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
        items.sort_by_key(|b| std::cmp::Reverse(b.assessment_datetime));
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
        items.sort_by_key(|b| std::cmp::Reverse(b.tbsa_percentage));
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
        items.sort_by_key(|b| std::cmp::Reverse(b.assessment_datetime));
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
                a.suicidal_ideation == Some(true)
                    || a.homicidal_ideation == Some(true)
                    || matches!(a.risk_level.as_deref(), Some("high" | "imminent"))
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
            .filter(|a| a.risk_level.as_deref() == Some(risk_level))
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
        items.sort_by_key(|b| std::cmp::Reverse(b.assessment_datetime));
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
        items.sort_by(|a, b| {
            b.assessment_datetime
                .cmp(&a.assessment_datetime)
                .then_with(|| b.id.cmp(&a.id))
        });
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
            .filter(|a| a.child_protective_concerns == Some(true))
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
        items.sort_by_key(|b| std::cmp::Reverse(b.assessment_datetime));
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
}
