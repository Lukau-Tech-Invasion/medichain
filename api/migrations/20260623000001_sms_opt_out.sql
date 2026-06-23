-- Migration: SMS Opt-out table
-- Phase 5.3 of IMPLEMENTATION_PLAN.md

CREATE TABLE IF NOT EXISTS sms_opt_outs (
    phone_number VARCHAR(32) PRIMARY KEY,
    opted_out_at TIMESTAMPTZ DEFAULT NOW(),
    source VARCHAR(50), -- STOP keyword, manual, api
    reason TEXT
);

CREATE INDEX idx_sms_opt_outs_phone ON sms_opt_outs(phone_number);
