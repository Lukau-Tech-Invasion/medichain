//! In-memory NFC tag repository implementation.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory NFC tag repository
#[derive(Debug)]
pub struct MemoryNfcTagRepository {
    storage: RwLock<HashMap<String, NfcTagEntity>>,
    uid_index: RwLock<HashMap<String, String>>,
    patient_index: RwLock<HashMap<String, Vec<String>>>,
}

impl MemoryNfcTagRepository {
    pub fn new() -> Self {
        Self {
            storage: RwLock::new(HashMap::new()),
            uid_index: RwLock::new(HashMap::new()),
            patient_index: RwLock::new(HashMap::new()),
        }
    }

    fn lock_error(e: impl std::fmt::Display) -> RepositoryError {
        RepositoryError::Internal(format!("Lock poisoned: {}", e))
    }
}

impl Default for MemoryNfcTagRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NfcTagRepository for MemoryNfcTagRepository {
    async fn create(&self, tag: NfcTagEntity) -> RepositoryResult<NfcTagEntity> {
        // Check for duplicates
        {
            let storage = self.storage.read().map_err(Self::lock_error)?;
            if storage.contains_key(&tag.id) {
                return Err(RepositoryError::Duplicate(format!(
                    "Tag {} already exists",
                    tag.id
                )));
            }
        }

        // Check UID uniqueness
        {
            let uid_index = self.uid_index.read().map_err(Self::lock_error)?;
            if uid_index.contains_key(&tag.tag_uid) {
                return Err(RepositoryError::Duplicate(format!(
                    "Tag UID {} already registered",
                    tag.tag_uid
                )));
            }
        }

        // Insert
        {
            let mut storage = self.storage.write().map_err(Self::lock_error)?;
            storage.insert(tag.id.clone(), tag.clone());
        }

        {
            let mut uid_index = self.uid_index.write().map_err(Self::lock_error)?;
            uid_index.insert(tag.tag_uid.clone(), tag.id.clone());
        }

        {
            let mut patient_index = self.patient_index.write().map_err(Self::lock_error)?;
            patient_index
                .entry(tag.patient_id.clone())
                .or_default()
                .push(tag.id.clone());
        }

        Ok(tag)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<NfcTagEntity> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        storage
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Tag {} not found", id)))
    }

    async fn get_by_uid(&self, uid: &str) -> RepositoryResult<NfcTagEntity> {
        let id = {
            let uid_index = self.uid_index.read().map_err(Self::lock_error)?;
            uid_index
                .get(uid)
                .cloned()
                .ok_or_else(|| RepositoryError::NotFound(format!("Tag UID {} not found", uid)))?
        };
        self.get_by_id(&id).await
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<NfcTagEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let patient_index = self.patient_index.read().map_err(Self::lock_error)?;

        let tags: Vec<NfcTagEntity> = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id).cloned())
                .collect(),
            None => Vec::new(),
        };

        Ok(tags)
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<NfcTagEntity>> {
        let tags = self.get_by_patient(patient_id).await?;
        Ok(tags.into_iter().find(|t| t.is_active))
    }

    async fn update(&self, tag: NfcTagEntity) -> RepositoryResult<NfcTagEntity> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;
        if !storage.contains_key(&tag.id) {
            return Err(RepositoryError::NotFound(format!(
                "Tag {} not found",
                tag.id
            )));
        }
        storage.insert(tag.id.clone(), tag.clone());
        Ok(tag)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;
        if let Some(tag) = storage.get_mut(id) {
            tag.is_active = false;
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!("Tag {} not found", id)))
        }
    }

    async fn record_usage(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;
        if let Some(tag) = storage.get_mut(id) {
            tag.use_count += 1;
            tag.last_used_at = Some(Utc::now());
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!("Tag {} not found", id)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_tag(id: &str, uid: &str, patient_id: &str) -> NfcTagEntity {
        NfcTagEntity {
            id: id.to_string(),
            tag_uid: uid.to_string(),
            patient_id: patient_id.to_string(),
            tag_type: "NTAG216".to_string(),
            is_active: true,
            pin_hash: None,
            issued_at: Utc::now(),
            expires_at: None,
            last_used_at: None,
            use_count: 0,
            issued_by: Some("ADMIN-001".to_string()),
        }
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let repo = MemoryNfcTagRepository::new();
        let tag = create_test_tag("TAG-001", "04:A1:B2:C3:D4:E5:F6", "PAT-001");

        let created = repo.create(tag).await.unwrap();
        assert_eq!(created.id, "TAG-001");

        let fetched = repo.get_by_uid("04:A1:B2:C3:D4:E5:F6").await.unwrap();
        assert_eq!(fetched.patient_id, "PAT-001");
    }

    #[tokio::test]
    async fn test_record_usage() {
        let repo = MemoryNfcTagRepository::new();
        let tag = create_test_tag("TAG-001", "04:A1:B2:C3:D4:E5:F6", "PAT-001");

        repo.create(tag).await.unwrap();
        repo.record_usage("TAG-001").await.unwrap();
        repo.record_usage("TAG-001").await.unwrap();

        let fetched = repo.get_by_id("TAG-001").await.unwrap();
        assert_eq!(fetched.use_count, 2);
        assert!(fetched.last_used_at.is_some());
    }
}
