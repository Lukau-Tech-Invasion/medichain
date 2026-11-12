//! In-memory repositories for immunization records.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory immunization record repository
#[derive(Debug, Default)]
pub struct MemoryImmunizationRecordRepository {
    records: RwLock<HashMap<String, ImmunizationRecordEntity>>,
}

impl MemoryImmunizationRecordRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ImmunizationRecordRepository for MemoryImmunizationRecordRepository {
    async fn create(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ImmunizationRecordEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Immunization {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_vaccine_type(
        &self,
        patient_id: &str,
        vaccine_type: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id && r.vaccine_type == vaccine_type)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Immunization {} not found",
                record.id
            )));
        }
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_recent(
        &self,
        patient_id: &str,
        days: i32,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let cutoff = chrono::Utc::now().date_naive() - chrono::Duration::days(days as i64);
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id && r.administration_date >= cutoff)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_lot_number(
        &self,
        lot_number: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.lot_number
                    .as_ref()
                    .map(|l| l == lot_number)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let records = self.records.read().unwrap();
        Ok(records.values().cloned().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_immunization_crud() {
        let repo = MemoryImmunizationRecordRepository::new();

        let record = ImmunizationRecordEntity {
            id: "IMM-001".to_string(),
            patient_id: "PAT-001".to_string(),
            vaccine_type: "COVID-19".to_string(),
            vaccine_name: "Pfizer-BioNTech".to_string(),
            administration_date: chrono::Utc::now().date_naive(),
            ..Default::default()
        };

        let created = repo.create(record).await.unwrap();
        assert_eq!(created.vaccine_type, "COVID-19");
    }
}
