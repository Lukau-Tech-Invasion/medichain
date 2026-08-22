-- Durable operation claims prevent a retry routed to another API process from
-- performing a second clinical mutation. No response body is retained here:
-- API responses can contain PHI, so duplicates receive a safe conflict rather
-- than a database replay of sensitive payloads.
CREATE TABLE IF NOT EXISTS idempotency_operations (
    id UUID PRIMARY KEY,
    subject VARCHAR(128) NOT NULL,
    method VARCHAR(10) NOT NULL,
    route TEXT NOT NULL,
    idempotency_key VARCHAR(256) NOT NULL,
    request_digest CHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT idempotency_operations_state CHECK (state IN ('processing', 'completed')),
    CONSTRAINT idempotency_operations_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT idempotency_operations_unique_operation UNIQUE (subject, method, route, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_operations_expiry
    ON idempotency_operations (expires_at);
