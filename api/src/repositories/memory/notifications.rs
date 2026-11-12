//! In-memory repositories for push device tokens and SMS opt-outs.

use super::lock_poisoned;
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory device token repository
#[derive(Debug, Default)]
pub struct MemoryDeviceTokenRepository {
    tokens: RwLock<HashMap<String, DeviceTokenEntity>>,
}

impl MemoryDeviceTokenRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl DeviceTokenRepository for MemoryDeviceTokenRepository {
    async fn register(&self, mut entity: DeviceTokenEntity) -> RepositoryResult<DeviceTokenEntity> {
        let mut tokens = self.tokens.write().map_err(lock_poisoned)?;

        // Check for existing token for this user to simulate ON CONFLICT
        let existing_id = tokens
            .values()
            .find(|t| t.user_id == entity.user_id && t.token == entity.token)
            .map(|t| t.id.clone());

        if let Some(id) = existing_id {
            if let Some(existing) = tokens.get_mut(&id) {
                existing.device_type = entity.device_type.clone();
                existing.device_name = entity.device_name.clone();
                existing.last_seen_at = Utc::now();
                return Ok(existing.clone());
            }
        }

        entity.last_seen_at = Utc::now();
        entity.created_at = Utc::now();
        tokens.insert(entity.id.clone(), entity.clone());
        Ok(entity)
    }

    async fn get_by_user(&self, user_id: &str) -> RepositoryResult<Vec<DeviceTokenEntity>> {
        let tokens = self.tokens.read().map_err(lock_poisoned)?;
        let result = tokens
            .values()
            .filter(|t| t.user_id == user_id)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn delete(&self, user_id: &str, token: &str) -> RepositoryResult<()> {
        let mut tokens = self.tokens.write().map_err(lock_poisoned)?;
        let id_to_remove = tokens
            .values()
            .find(|t| t.user_id == user_id && t.token == token)
            .map(|t| t.id.clone());

        if let Some(id) = id_to_remove {
            tokens.remove(&id);
        }
        Ok(())
    }

    async fn update_last_seen(&self, id: &str) -> RepositoryResult<()> {
        let mut tokens = self.tokens.write().map_err(lock_poisoned)?;
        if let Some(token) = tokens.get_mut(id) {
            token.last_seen_at = Utc::now();
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Device token {} not found",
                id
            )))
        }
    }
}

/// In-memory SMS opt-out repository
#[derive(Debug, Default)]
pub struct MemorySmsOptOutRepository {
    opt_outs: RwLock<HashMap<String, SmsOptOutEntity>>,
}

impl MemorySmsOptOutRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl SmsOptOutRepository for MemorySmsOptOutRepository {
    async fn add_opt_out(&self, entity: SmsOptOutEntity) -> RepositoryResult<()> {
        let mut opt_outs = self.opt_outs.write().map_err(lock_poisoned)?;
        opt_outs.insert(entity.phone_number.clone(), entity);
        Ok(())
    }

    async fn is_opted_out(&self, phone_number: &str) -> RepositoryResult<bool> {
        let opt_outs = self.opt_outs.read().map_err(lock_poisoned)?;
        Ok(opt_outs.contains_key(phone_number))
    }

    async fn remove_opt_out(&self, phone_number: &str) -> RepositoryResult<()> {
        let mut opt_outs = self.opt_outs.write().map_err(lock_poisoned)?;
        opt_outs.remove(phone_number);
        Ok(())
    }
}
