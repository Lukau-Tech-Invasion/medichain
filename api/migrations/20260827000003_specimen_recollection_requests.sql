-- Specimen recollection requests (SCR-009b).
--
-- A rejected specimen cannot be un-rejected. When the laboratory needs another
-- sample, that is a NEW act with its own authority, timing and outcome, and it
-- must be recorded as such rather than by mutating the rejection until it looks
-- as though nothing went wrong. `specimen_rejections` therefore stays exactly as
-- written, permanently, and this table references it.
--
-- Notify and Recollect are different actions and remain separate. Telling the
-- ordering provider a specimen failed is `specimen_rejections.notified_ordering_provider`;
-- obtaining another sample from the patient is a row here.
--
-- LINEAGE
--
-- `rejection_id` and `original_specimen_id` both point backwards, so the chain
-- rejected specimen -> request -> replacement specimen is navigable from either
-- end. `replacement_specimen_id` is null until the recollection is completed,
-- which is what makes the replacement distinguishable from the specimen it
-- replaces: they are different rows in `specimen_collections` joined by this
-- request, not one row edited twice.
CREATE TABLE IF NOT EXISTS specimen_recollection_requests (
    id VARCHAR(64) PRIMARY KEY,
    rejection_id VARCHAR(64) NOT NULL REFERENCES specimen_rejections(id),
    original_specimen_id VARCHAR(64) NOT NULL REFERENCES specimen_collections(id),
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    -- The clinician who must know a fresh sample is needed. Nullable because a
    -- rejection can predate the submission that names the ordering provider,
    -- and refusing to record the recollection at all in that case would be
    -- worse than recording it unaddressed.
    ordering_provider_id VARCHAR(64),
    requested_by VARCHAR(64) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'collected', 'cancelled')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Set together, on completion, with the replacement.
    replacement_specimen_id VARCHAR(64) REFERENCES specimen_collections(id),
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A completed request must name what replaced the specimen, and a request
    -- that names a replacement must be completed. Without this the two could
    -- drift and the lineage would claim a replacement that does not exist.
    CONSTRAINT recollection_completion_is_whole CHECK (
        (status = 'collected'
            AND replacement_specimen_id IS NOT NULL
            AND completed_at IS NOT NULL)
        OR (status <> 'collected'
            AND replacement_specimen_id IS NULL
            AND completed_at IS NULL)
    ),

    -- Likewise for cancellation: a reason and a time, or neither.
    CONSTRAINT recollection_cancellation_is_whole CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
        OR (status <> 'cancelled' AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    )
);

-- At most one OPEN request per rejection, enforced by the database rather than
-- by reading before writing.
--
-- Two technicians looking at the same rejected specimen will both press
-- Recollect; that is the normal case, not the exotic one. A SELECT-then-INSERT
-- lets both through and sends the patient two appointments. A partial unique
-- index makes the second INSERT fail regardless of interleaving, and the
-- handler turns that failure into "a recollection is already open for this
-- rejection".
--
-- Partial, so that a cancelled or completed request does not block a legitimate
-- second attempt: a recollection that was cancelled, or whose replacement was
-- itself rejected, must be requestable again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recollection_one_open_per_rejection
    ON specimen_recollection_requests (rejection_id)
    WHERE status = 'requested';

CREATE INDEX IF NOT EXISTS idx_recollection_patient
    ON specimen_recollection_requests (patient_id);
CREATE INDEX IF NOT EXISTS idx_recollection_status
    ON specimen_recollection_requests (status);
CREATE INDEX IF NOT EXISTS idx_recollection_requested_at
    ON specimen_recollection_requests (requested_at DESC);
