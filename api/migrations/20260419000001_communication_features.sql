-- Migration: Communication Features (FCM device tokens)
-- Phase 5 of IMPLEMENTATION_PLAN.md

CREATE TABLE IF NOT EXISTS device_tokens (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    token TEXT NOT NULL,
    device_type VARCHAR(50), -- android, ios, web
    device_name VARCHAR(100),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, token)
);

CREATE INDEX idx_device_tokens_user_id ON device_tokens(user_id);
