-- Legal-authority evidence and child participation for guardian relationships.
--
-- Prompted by the 2026-07-28 POPIA legal review (docs/PRODUCTION_READINESS_GATES.md
-- section 3). The existing model (Admin-verified, permission-scoped,
-- time-limited) is good security engineering but does not by itself satisfy
-- POPIA ss.34-35 for a minor's health information. The review's findings, and
-- what each column below answers:
--
--   "Verify the person is LEGALLY authorised, not merely an adult relative"
--       -> authority_evidence_type / authority_evidence_reference /
--          authority_issuing_authority
--   "Record evidence type, issuing authority, verification date, reviewer"
--       -> the above plus authority_verified_by_role (verified_by alone is a
--          bare wallet address, which does not record WHO in any human sense)
--   "Periodic re-verification"
--       -> next_reverification_due (distinct from expires_at: a relationship can
--          be indefinite yet still need periodic review)
--   "Child participation/assent appropriate to age and maturity"
--       -> child_assent_status / child_assent_recorded_at / child_assent_notes
--   "Handle expired authority, custody disputes, changed guardianship"
--       -> supersedes_relationship_id (custody transfer chain) and
--          dispute_flag / dispute_notes
--
-- Additive only. The base table (20260728000001) is left untouched rather than
-- edited in place, because it has already been applied to local databases.

ALTER TABLE guardian_relationships
    -- What document establishes this person's legal authority.
    ADD COLUMN IF NOT EXISTS authority_evidence_type TEXT
        CHECK (authority_evidence_type IS NULL OR authority_evidence_type IN (
            'birth_certificate',
            'court_order',
            'adoption_order',
            'power_of_attorney_document',
            'foster_placement_order',
            'affidavit',
            'other'
        )),

    -- A reference to that document (record id or IPFS hash) -- NEVER the
    -- document contents. Guardianship papers contain third-party PII of their
    -- own; this table stores a pointer, consistent with the project's
    -- "hashes and pointers, not payloads" rule.
    ADD COLUMN IF NOT EXISTS authority_evidence_reference TEXT,

    -- Which court, home-affairs office, or authority issued it.
    ADD COLUMN IF NOT EXISTS authority_issuing_authority TEXT,

    -- Role/title of the person who verified the evidence. `verified_by` records
    -- only a wallet address, which is not an accountable human identity.
    ADD COLUMN IF NOT EXISTS authority_verified_by_role TEXT,

    ADD COLUMN IF NOT EXISTS authority_evidence_recorded_at TIMESTAMPTZ,

    -- Periodic re-verification. Distinct from expires_at: an indefinite
    -- relationship still needs review, and a relationship overdue for review is
    -- not automatically invalid -- it is flagged.
    ADD COLUMN IF NOT EXISTS next_reverification_due TIMESTAMPTZ,

    -- Children's Act participation. A child's own view on decisions about them
    -- is legally relevant and was previously unrecordable.
    ADD COLUMN IF NOT EXISTS child_assent_status TEXT
        CHECK (child_assent_status IS NULL OR child_assent_status IN (
            'not_applicable',   -- ward is an adult
            'not_sought',       -- should have been asked; wasn't (visible gap, not hidden)
            'given',
            'refused',          -- recorded even though the guardian may still consent
            'unable'            -- too young / clinically unable to participate
        )),
    ADD COLUMN IF NOT EXISTS child_assent_recorded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS child_assent_notes TEXT,

    -- Changed guardianship: points at the relationship this one replaces, so a
    -- custody transfer is an auditable chain rather than a silent overwrite.
    ADD COLUMN IF NOT EXISTS supersedes_relationship_id TEXT,

    -- Custody dispute. A disputed relationship stays active (removing access
    -- unilaterally could itself cause harm) but is flagged for human review.
    ADD COLUMN IF NOT EXISTS dispute_flag BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dispute_notes TEXT;

-- Self-referencing chain for superseded relationships.
ALTER TABLE guardian_relationships
    DROP CONSTRAINT IF EXISTS fk_guardian_supersedes;

ALTER TABLE guardian_relationships
    ADD CONSTRAINT fk_guardian_supersedes
    FOREIGN KEY (supersedes_relationship_id)
    REFERENCES guardian_relationships (id)
    ON DELETE SET NULL
    NOT VALID;

-- Relationships needing human attention: overdue re-verification, or disputed.
CREATE INDEX IF NOT EXISTS idx_guardian_reverification_due
    ON guardian_relationships (next_reverification_due)
    WHERE active AND next_reverification_due IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guardian_disputed
    ON guardian_relationships (ward_patient_id)
    WHERE dispute_flag;
