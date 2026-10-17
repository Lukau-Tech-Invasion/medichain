//! Adoption of historical migrations rewritten to stop seeding demo identities.
//!
//! The first schema migration and the demo-patients migration used to insert
//! credentialless demo accounts, synthetic patients and NFC tags; four later
//! migrations existed only to mark and delete them again. All six are now
//! rewritten so a fresh database is never seeded. SQLx refuses to start against
//! a database whose recorded checksum differs from the shipped file, so a
//! database that applied the original forms has its ledger updated here — but
//! only when the whole original cleanup chain has completed, because only then
//! does that database hold exactly what the rewritten forms produce.

use sqlx::migrate::Migrator;
use sqlx::PgConnection;

/// Each rewritten version with the SHA-384 checksum of its original form.
const REWRITTEN: [(i64, &str); 6] = [
    (20240121000001, "c23b191f14883c59bffb94152108a4b94cd61c6e5c20091d06f2afc5cd240f9addf9997a508270fe5832c38d8a8408b9"),
    (20260126000001, "6b475b28e3222d7cad30fba38ff6a39d9fa21b94210e2d67d8e699f3dd7ba2cf1f93e1a5dd9b26653592c73a97f95347"),
    (20261004000003, "6f430a77d12091672aefdc8ecba2f88047a12ade36e5f0e955ea57e83e71f28686418a2a673b349de2c44c3c5144a646"),
    (20261005000001, "9399113f50679ea3c4c88e2b7e3e2489a3e66b641bd62b2a8bb727122403a71ac2d710e13ba47817eab53459e3d41139"),
    (20261005000002, "668d321fd4b36ca7e9f2f3676e3af56b85a6da6c987a94ed73d68ae178b1f95624f6a2009bee38c2c11a82c743df6505"),
    (20261006000001, "a89b28a56e5eb9261a2f8cd346526f19c97b1c3b1693b7bbbd02a4d1b753bc0642950aba407d5a795b9c728da43e63a9"),
];

/// The last migration of the original cleanup chain. Once it has succeeded the
/// seeded rows and their marker table are gone.
const CLEANUP_COMPLETE: i64 = 20261006000001;

/// Record the rewritten checksums on a database that applied the original
/// forms and completed their cleanup. Returns how many ledger rows changed.
///
/// A fresh database has nothing to adopt. A database that applied the seeding
/// forms but not the full cleanup is left untouched, so SQLx stops on the
/// checksum mismatch rather than accepting a database that still holds seeds.
pub async fn adopt_rewritten_seed_migrations(
    conn: &mut PgConnection,
    migrator: &Migrator,
) -> Result<u64, sqlx::Error> {
    let ledger: Option<String> = sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations')::text")
        .fetch_one(&mut *conn)
        .await?;
    if ledger.is_none() {
        return Ok(0);
    }
    let cleaned: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM _sqlx_migrations WHERE version = $1 AND success)",
    )
    .bind(CLEANUP_COMPLETE)
    .fetch_one(&mut *conn)
    .await?;
    if !cleaned {
        return Ok(0);
    }
    let mut adopted = 0;
    for (version, original) in REWRITTEN {
        let Some(shipped) = migrator.iter().find(|m| m.version == version) else {
            continue;
        };
        adopted += sqlx::query(
            "UPDATE _sqlx_migrations SET checksum = $1
             WHERE version = $2 AND checksum = decode($3, 'hex')",
        )
        .bind(shipped.checksum.to_vec())
        .bind(version)
        .bind(original)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    }
    Ok(adopted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_rewritten_version_ships_with_a_new_checksum() {
        let migrator = sqlx::migrate!("./migrations");
        for (version, original) in REWRITTEN {
            let shipped = migrator
                .iter()
                .find(|m| m.version == version)
                .unwrap_or_else(|| panic!("{version} is not shipped"));
            let hex: String = shipped
                .checksum
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            assert_ne!(hex, original, "{version} still has its seeding form");
        }
    }

    #[test]
    fn the_cleanup_marker_is_one_of_the_rewritten_versions() {
        assert!(REWRITTEN.iter().any(|(v, _)| *v == CLEANUP_COMPLETE));
    }
}
