//! Push device tokens and SMS opt-outs.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::RepositoryResult;

/// Device token entity for push notifications
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DeviceTokenEntity {
    pub id: String,
    pub user_id: String,
    pub token: String,
    pub device_type: Option<String>,
    pub device_name: Option<String>,
    pub last_seen_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

/// Device token repository trait
#[async_trait]
pub trait DeviceTokenRepository: Send + Sync + fmt::Debug {
    async fn register(&self, entity: DeviceTokenEntity) -> RepositoryResult<DeviceTokenEntity>;
    async fn get_by_user(&self, user_id: &str) -> RepositoryResult<Vec<DeviceTokenEntity>>;
    async fn delete(&self, user_id: &str, token: &str) -> RepositoryResult<()>;
    async fn update_last_seen(&self, id: &str) -> RepositoryResult<()>;
}

/// SMS opt-out entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct SmsOptOutEntity {
    pub phone_number: String,
    pub opted_out_at: DateTime<Utc>,
    pub source: Option<String>,
    pub reason: Option<String>,
}

/// SMS opt-out repository trait
#[async_trait]
pub trait SmsOptOutRepository: Send + Sync + fmt::Debug {
    async fn add_opt_out(&self, entity: SmsOptOutEntity) -> RepositoryResult<()>;
    async fn is_opted_out(&self, phone_number: &str) -> RepositoryResult<bool>;
    async fn remove_opt_out(&self, phone_number: &str) -> RepositoryResult<()>;
}
