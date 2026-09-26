-- =============================================================================
-- Backup canaries (WP11)
-- =============================================================================
-- The nightly backup writes one row here just before it runs, and the
-- scripted restore test looks for that exact row in the restored copy. A
-- restore that silently produced an empty or stale database, or read the live
-- one, cannot find it. Operational only: no patient data.
-- =============================================================================

CREATE TABLE IF NOT EXISTS backup_canaries (
    id          TEXT PRIMARY KEY CHECK (id ~ '^canary-[0-9A-Za-z-]{8,64}$'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
