//! One instance at a time for each background job (WP11).
//!
//! Every periodic job runs in every API instance. With two instances behind a
//! load balancer, each reminder would be sent twice, each retention pass would
//! run twice, and two outbox workers would race. A job run here first takes a
//! PostgreSQL advisory lock named for the job, on a connection it holds for the
//! whole run; an instance that cannot take it skips that run. The lock goes
//! with the connection, so a crashed instance never leaves a job stuck.
//!
//! On the in-memory backend there is only ever one instance, so jobs run
//! directly.

use std::future::Future;

use sqlx::PgPool;

/// The background jobs, each with its own advisory-lock key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobKey {
    OutboxDelivery,
    MedicationReminders,
    AppointmentReminders,
    RetentionAssessment,
    DeferredEmergencyAudit,
}

impl JobKey {
    /// The job's advisory-lock key: a fixed prefix ("MCJOB" in ASCII) and a
    /// number per job, so keys never collide with each other or with the
    /// audit-batching lock.
    pub fn lock_key(self) -> i64 {
        const PREFIX: i64 = 0x4d43_4a4f_4200_0000;
        PREFIX
            + match self {
                Self::OutboxDelivery => 1,
                Self::MedicationReminders => 2,
                Self::AppointmentReminders => 3,
                Self::RetentionAssessment => 4,
                Self::DeferredEmergencyAudit => 5,
            }
    }
}

/// Run `job` if this instance can take `key`'s lock.
///
/// Returns `Some(output)` when it ran, `None` when another instance holds the
/// lock or the lock could not be asked for (logged; skipping a run is always
/// safe, running it twice is not). Without a pool the job simply runs.
pub async fn run_exclusive<F, Fut, T>(pool: Option<&PgPool>, key: JobKey, job: F) -> Option<T>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    let Some(pool) = pool else {
        return Some(job().await);
    };
    let mut connection = match pool.acquire().await {
        Ok(connection) => connection,
        Err(error) => {
            log::error!("{key:?}: no connection for its job lock, skipping this run: {error}");
            return None;
        }
    };
    let locked: bool = match sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(key.lock_key())
        .fetch_one(&mut *connection)
        .await
    {
        Ok(locked) => locked,
        Err(error) => {
            log::error!("{key:?}: job lock query failed, skipping this run: {error}");
            return None;
        }
    };
    if !locked {
        return None;
    }
    let output = job().await;
    if let Err(error) = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(key.lock_key())
        .execute(&mut *connection)
        .await
    {
        // Dropping the connection below would leave the lock held by a pooled
        // session; close it instead so the lock is released with it.
        log::error!("{key:?}: job lock release failed, closing its connection: {error}");
        let _closed = connection.detach();
    }
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_job_has_its_own_key() {
        let keys = [
            JobKey::OutboxDelivery,
            JobKey::MedicationReminders,
            JobKey::AppointmentReminders,
            JobKey::RetentionAssessment,
            JobKey::DeferredEmergencyAudit,
        ]
        .map(JobKey::lock_key);
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len());
    }

    #[tokio::test]
    async fn without_a_pool_the_job_runs() {
        assert_eq!(
            run_exclusive(None, JobKey::MedicationReminders, || async { 7 }).await,
            Some(7)
        );
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;

    /// While another session holds a job's lock, this instance skips the run;
    /// once it is released, the run goes ahead and releases it again.
    #[tokio::test]
    async fn a_second_instance_skips_while_the_first_holds_the_lock() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let key = JobKey::RetentionAssessment;
        let mut other = pool.acquire().await.unwrap();
        let held: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
            .bind(key.lock_key())
            .fetch_one(&mut *other)
            .await
            .unwrap();
        assert!(held);
        assert_eq!(
            run_exclusive(Some(&pool), key, || async { "ran" }).await,
            None
        );

        sqlx::query("SELECT pg_advisory_unlock($1)")
            .bind(key.lock_key())
            .execute(&mut *other)
            .await
            .unwrap();
        assert_eq!(
            run_exclusive(Some(&pool), key, || async { "ran" }).await,
            Some("ran")
        );
        // Released after the run: it can be taken again.
        let again: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
            .bind(key.lock_key())
            .fetch_one(&mut *other)
            .await
            .unwrap();
        assert!(again);
        sqlx::query("SELECT pg_advisory_unlock($1)")
            .bind(key.lock_key())
            .execute(&mut *other)
            .await
            .unwrap();
        pool.close().await;
    }
}
