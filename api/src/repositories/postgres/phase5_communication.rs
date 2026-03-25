use crate::repositories::traits::{DeviceTokenEntity, DeviceTokenRepository, RepositoryResult};
use async_trait::async_trait;
use sqlx::{PgPool, Postgres};

#[derive(Debug, Clone)]
pub struct PgDeviceTokenRepository {
    pool: PgPool,
}

impl PgDeviceTokenRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DeviceTokenRepository for PgDeviceTokenRepository {
    async fn register(&self, entity: DeviceTokenEntity) -> RepositoryResult<DeviceTokenEntity> {
        let result = sqlx::query_as::<Postgres, DeviceTokenEntity>(
            r#"
            INSERT INTO device_tokens (id, user_id, token, device_type, device_name, last_seen_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_id, token) DO UPDATE
            SET device_type = EXCLUDED.device_type,
                device_name = EXCLUDED.device_name,
                last_seen_at = NOW()
            RETURNING id, user_id, token, device_type, device_name, last_seen_at, created_at
            "#,
        )
        .bind(&entity.id)
        .bind(&entity.user_id)
        .bind(&entity.token)
        .bind(&entity.device_type)
        .bind(&entity.device_name)
        .bind(entity.last_seen_at)
        .bind(entity.created_at)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn get_by_user(&self, user_id: &str) -> RepositoryResult<Vec<DeviceTokenEntity>> {
        let result = sqlx::query_as::<Postgres, DeviceTokenEntity>(
            "SELECT id, user_id, token, device_type, device_name, last_seen_at, created_at FROM device_tokens WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn delete(&self, user_id: &str, token: &str) -> RepositoryResult<()> {
        sqlx::query(
            "DELETE FROM device_tokens WHERE user_id = $1 AND token = $2",
        )
        .bind(user_id)
        .bind(token)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn update_last_seen(&self, id: &str) -> RepositoryResult<()> {
        sqlx::query(
            "UPDATE device_tokens SET last_seen_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
