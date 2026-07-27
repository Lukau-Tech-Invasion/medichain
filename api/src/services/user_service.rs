//! User Service - Database operations for user management
//!
//! Provides CRUD operations for users with PostgreSQL.

use crate::models::user::{CreateUserRequest, DbUser, DbUserProfile};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

/// User service for database operations
#[allow(dead_code)]
#[derive(Clone)]
pub struct UserService {
    pool: PgPool,
}

#[allow(dead_code)]
impl UserService {
    /// Create a new UserService with the given database pool
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Register a new user
    pub async fn register_user(
        &self,
        req: &CreateUserRequest,
        created_by: Option<&str>,
    ) -> Result<DbUser, sqlx::Error> {
        let user = sqlx::query_as::<_, DbUser>(
            r#"
            INSERT INTO users (wallet_address, role, name, username, email, linked_patient_id, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#
        )
        .bind(&req.wallet_address)
        .bind(&req.role)
        .bind(&req.name)
        .bind(&req.username)
        .bind(&req.email)
        .bind(&req.linked_patient_id)
        .bind(created_by)
        .fetch_one(&self.pool)
        .await?;

        log::info!("User registered: {} ({})", user.wallet_address, user.role);
        Ok(user)
    }

    /// Get user by wallet address
    pub async fn get_user_by_wallet(&self, wallet: &str) -> Result<Option<DbUser>, sqlx::Error> {
        sqlx::query_as::<_, DbUser>(
            "SELECT * FROM users WHERE wallet_address = $1 AND is_active = true",
        )
        .bind(wallet)
        .fetch_optional(&self.pool)
        .await
    }

    /// Get user by ID
    pub async fn get_user_by_id(&self, user_id: Uuid) -> Result<Option<DbUser>, sqlx::Error> {
        sqlx::query_as::<_, DbUser>("SELECT * FROM users WHERE id = $1 AND is_active = true")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
    }

    /// List all users (for admin)
    pub async fn list_users(&self) -> Result<Vec<DbUser>, sqlx::Error> {
        sqlx::query_as::<_, DbUser>(
            "SELECT * FROM users WHERE is_active = true ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
    }

    /// List users by role
    pub async fn list_users_by_role(&self, role: &str) -> Result<Vec<DbUser>, sqlx::Error> {
        sqlx::query_as::<_, DbUser>(
            "SELECT * FROM users WHERE role = $1 AND is_active = true ORDER BY created_at DESC",
        )
        .bind(role)
        .fetch_all(&self.pool)
        .await
    }

    /// Update login tracking
    pub async fn update_login_info(&self, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE users
            SET last_login_at = $1, login_count = login_count + 1
            WHERE id = $2
            "#,
        )
        .bind(Utc::now())
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Deactivate a user (soft delete)
    pub async fn deactivate_user(&self, user_id: Uuid) -> Result<bool, sqlx::Error> {
        let result =
            sqlx::query("UPDATE users SET is_active = false, updated_at = $1 WHERE id = $2")
                .bind(Utc::now())
                .bind(user_id)
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Update user role
    pub async fn update_role(&self, user_id: Uuid, new_role: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("UPDATE users SET role = $1, updated_at = $2 WHERE id = $3")
            .bind(new_role)
            .bind(Utc::now())
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Check if any users exist (for bootstrap)
    pub async fn has_users(&self) -> Result<bool, sqlx::Error> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
            .fetch_one(&self.pool)
            .await?;
        Ok(count.0 > 0)
    }

    /// Check if user with wallet exists
    pub async fn wallet_exists(&self, wallet: &str) -> Result<bool, sqlx::Error> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE wallet_address = $1")
            .bind(wallet)
            .fetch_one(&self.pool)
            .await?;
        Ok(count.0 > 0)
    }

    /// Get user profile by user ID
    pub async fn get_user_profile(
        &self,
        user_id: Uuid,
    ) -> Result<Option<DbUserProfile>, sqlx::Error> {
        sqlx::query_as::<_, DbUserProfile>("SELECT * FROM user_profiles WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Create or update user profile with all fields
    #[allow(clippy::too_many_arguments)]
    pub async fn upsert_profile(
        &self,
        user_id: Uuid,
        first_name: Option<&str>,
        last_name: Option<&str>,
        specialty: Option<&str>,
        department: Option<&str>,
        license_number: Option<&str>,
        phone: Option<&str>,
        date_of_birth: Option<chrono::NaiveDate>,
        address_line1: Option<&str>,
        address_line2: Option<&str>,
        city: Option<&str>,
        state: Option<&str>,
        postal_code: Option<&str>,
        country: Option<&str>,
    ) -> Result<DbUserProfile, sqlx::Error> {
        sqlx::query_as::<_, DbUserProfile>(
            r#"
            INSERT INTO user_profiles (
                user_id, first_name, last_name, specialty, department, license_number,
                phone, date_of_birth, address_line1, address_line2, city, state, postal_code, country
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (user_id) DO UPDATE SET
                first_name = COALESCE(EXCLUDED.first_name, user_profiles.first_name),
                last_name = COALESCE(EXCLUDED.last_name, user_profiles.last_name),
                specialty = COALESCE(EXCLUDED.specialty, user_profiles.specialty),
                department = COALESCE(EXCLUDED.department, user_profiles.department),
                license_number = COALESCE(EXCLUDED.license_number, user_profiles.license_number),
                phone = COALESCE(EXCLUDED.phone, user_profiles.phone),
                date_of_birth = COALESCE(EXCLUDED.date_of_birth, user_profiles.date_of_birth),
                address_line1 = COALESCE(EXCLUDED.address_line1, user_profiles.address_line1),
                address_line2 = COALESCE(EXCLUDED.address_line2, user_profiles.address_line2),
                city = COALESCE(EXCLUDED.city, user_profiles.city),
                state = COALESCE(EXCLUDED.state, user_profiles.state),
                postal_code = COALESCE(EXCLUDED.postal_code, user_profiles.postal_code),
                country = COALESCE(EXCLUDED.country, user_profiles.country),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
            "#
        )
        .bind(user_id)
        .bind(first_name)
        .bind(last_name)
        .bind(specialty)
        .bind(department)
        .bind(license_number)
        .bind(phone)
        .bind(date_of_birth)
        .bind(address_line1)
        .bind(address_line2)
        .bind(city)
        .bind(state)
        .bind(postal_code)
        .bind(country)
        .fetch_one(&self.pool)
        .await
    }

    /// Count users by role (for dashboard metrics)
    pub async fn count_by_role(&self) -> Result<Vec<(String, i64)>, sqlx::Error> {
        let rows: Vec<(String, i64)> = sqlx::query_as(
            r#"
            SELECT role, COUNT(*) as count
            FROM users
            WHERE is_active = true
            GROUP BY role
            ORDER BY count DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}
