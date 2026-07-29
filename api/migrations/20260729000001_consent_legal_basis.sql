-- POPIA lawful-basis provenance for consent records.
--
-- Prompted by the 2026-07-28 POPIA legal review (docs/PRODUCTION_READINESS_GATES.md
-- section 2), which found the existing `consent_given BOOLEAN` insufficient:
-- consent is only one of the POPIA s11 lawful-processing grounds, health data
-- additionally needs an s32 special-information authorisation, a minor's data
-- needs an s35 children's-information ground, and a National Health Act
-- emergency justifies processing WITHOUT consent -- which must be recorded as
-- its own justification rather than falsely logged as consent given.
--
-- Additive only: no column is dropped or retyped, so existing rows and the
-- current frontend keep working. `consent_given` is retained but becomes a
-- derived projection of `consent_status` (see api/src/types/legal_basis.rs
-- ConsentStatus::as_legacy_bool).
--
-- Several fields the review asked for already exist on this table and are
-- deliberately REUSED rather than duplicated:
--   processing_purpose  -> purpose
--   scope_of_consent    -> scope_description
--   granted_at          -> consent_datetime
--   expires_at          -> expiration_datetime
--   withdrawn_at        -> revoked_datetime
--   withdrawal_reason   -> revocation_reason
--   recorded_by         -> collector_id

ALTER TABLE consent_records
    -- POPIA s11 lawful-processing ground. Defaulted to 'consent' for existing
    -- rows because every row written before this migration came from the
    -- consent-signing endpoint, where consent was in fact the operative ground.
    ADD COLUMN IF NOT EXISTS popia_section_11_basis VARCHAR(64) NOT NULL DEFAULT 'consent',

    -- POPIA s27/s32 authorisation for SPECIAL personal information (health).
    -- Required in addition to the s11 ground for any health data.
    ADD COLUMN IF NOT EXISTS special_information_basis VARCHAR(64) NOT NULL DEFAULT 's32_treatment',

    -- POPIA s34/s35 children's-information ground. Layers ON TOP of the
    -- special-information basis for a minor; 'not_applicable' for adults.
    ADD COLUMN IF NOT EXISTS child_information_basis VARCHAR(64) NOT NULL DEFAULT 'not_applicable',

    -- Whether consent is the operative ground at all. FALSE when processing
    -- proceeds on another s11 ground (legal obligation, vital interest, etc.).
    ADD COLUMN IF NOT EXISTS consent_required BOOLEAN NOT NULL DEFAULT TRUE,

    -- Lifecycle state. Authoritative; `consent_given` is derived from this.
    -- Backfilled from the existing revoked/consent_given booleans below.
    ADD COLUMN IF NOT EXISTS consent_status VARCHAR(32) NOT NULL DEFAULT 'granted',

    -- Who actually gave consent (may differ from patient_id: a guardian, a
    -- court-appointed proxy, or a mature minor consenting for themselves).
    ADD COLUMN IF NOT EXISTS consent_given_by VARCHAR(64),

    -- In what capacity they acted. Drives whether authority evidence is needed.
    ADD COLUMN IF NOT EXISTS consent_giver_capacity VARCHAR(32),

    -- Link to the verified guardian relationship that authorised a third party
    -- to consent. Required when consent_giver_capacity is guardian/
    -- competent_person/legal_proxy -- enforced in the handler, not as a NOT NULL
    -- constraint, since it is conditional on capacity.
    ADD COLUMN IF NOT EXISTS guardian_authority_evidence_id VARCHAR(64),

    -- Which version of the privacy notice the data subject was shown. POPIA
    -- consent must be informed; without this we cannot say what they were told.
    ADD COLUMN IF NOT EXISTS privacy_notice_version VARCHAR(64),

    -- National Health Act emergency ground, when treatment proceeded without
    -- ordinary informed consent.
    ADD COLUMN IF NOT EXISTS emergency_basis VARCHAR(32) NOT NULL DEFAULT 'none',

    -- Free-text justification, required whenever emergency_basis <> 'none'.
    -- An emergency override with no recorded reason is unauditable.
    ADD COLUMN IF NOT EXISTS emergency_justification TEXT;

-- Backfill consent_status from the pre-existing boolean pair so historical rows
-- carry a truthful lifecycle state rather than the blanket 'granted' default.
-- Order matters: a revoked row is 'withdrawn' regardless of consent_given.
UPDATE consent_records
   SET consent_status = CASE
       WHEN revoked IS TRUE       THEN 'withdrawn'
       WHEN consent_given IS TRUE THEN 'granted'
       ELSE 'refused'
   END
 WHERE consent_status = 'granted';

-- Foreign key to the authorising guardian relationship. NOT VALID so the
-- migration cannot fail on any pre-existing row; new writes are still checked.
ALTER TABLE consent_records
    DROP CONSTRAINT IF EXISTS fk_consent_guardian_authority;

ALTER TABLE consent_records
    ADD CONSTRAINT fk_consent_guardian_authority
    FOREIGN KEY (guardian_authority_evidence_id)
    REFERENCES guardian_relationships (id)
    ON DELETE SET NULL
    NOT VALID;

-- Find every record processed under a given lawful basis (a standing question
-- from any regulator enquiry or data-subject access request).
CREATE INDEX IF NOT EXISTS idx_consent_s11_basis
    ON consent_records (popia_section_11_basis);

CREATE INDEX IF NOT EXISTS idx_consent_status
    ON consent_records (consent_status);

-- Emergency-basis processing is the highest-scrutiny category; make it cheap to
-- enumerate for retrospective review.
CREATE INDEX IF NOT EXISTS idx_consent_emergency_basis
    ON consent_records (emergency_basis)
    WHERE emergency_basis <> 'none';
