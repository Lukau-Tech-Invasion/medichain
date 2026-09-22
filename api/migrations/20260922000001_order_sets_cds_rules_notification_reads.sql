-- Clinician-authored order sets, under pharmacist review.
--
-- The order-set screen's Create and Duplicate announced success and changed
-- only the browser's list: the set vanished on reload and nobody else ever saw
-- it, while `GET /api/order-sets` served three hardcoded bundles with nowhere
-- to put a fourth.
--
-- `owner_id` is the drafting clinician's wallet. The bundle, its ordered
-- orders, and its state (pending_approval / approved / rejected / retired)
-- live in `data`; the state is the guard column for the conditional write in
-- `decide_order_set`, so it is indexed. Rows are retired, never deleted
-- (ADR-0005).
CREATE TABLE IF NOT EXISTS order_sets (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_sets_owner ON order_sets (owner_id);
CREATE INDEX IF NOT EXISTS idx_order_sets_status ON order_sets ((data ->> 'status'));

-- Clinical-decision-support rules, written by administrators.
--
-- The CDS screen's Create, Duplicate, Enable/Disable and Delete changed only
-- the browser's array, and its list came from the *alerts* endpoint, so the
-- screen showed fired instances under the heading "rules". `owner_id` is the
-- authoring administrator's wallet; the rule body, its conditions and actions,
-- its enablement and its retired flag live in `data`. `status` is the guard
-- column for the conditional writes in `set_cds_rule_enablement` and
-- `retire_cds_rule`. Rules are retired, never deleted: the CDS audit trail
-- names the rule that fired, and a deleted rule makes every one of those
-- entries unresolvable.
CREATE TABLE IF NOT EXISTS cds_rules (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_rules_owner ON cds_rules (owner_id);
CREATE INDEX IF NOT EXISTS idx_cds_rules_status ON cds_rules ((data ->> 'status'));

-- When each user last read their notification list.
--
-- `GET /api/notifications` derives its entries from live clinical state, and
-- reported `unread_count = notifications.len()` -- every notification was
-- unread forever, so the bell's badge could never be cleared by reading them.
-- One row per user; `data.read_at` is the marker an entry's own timestamp is
-- compared against.
CREATE TABLE IF NOT EXISTS notification_reads (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
