-- A provider may have one outstanding request for a patient at a time. Without
-- this constraint, concurrent submissions or retries using distinct operation
-- keys can flood the patient's consent queue with equivalent pending requests.
--
-- Existing duplicate pending decisions are legally significant. Do not silently
-- delete or deny them during a schema upgrade: halt so an operator can review
-- and decide each historical request before the invariant is enforced.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM patient_access_requests
        WHERE status = 'pending'
        GROUP BY patient_id, provider_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce one pending patient-access request per provider: historical duplicates require manual review';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_access_requests_pending_provider
    ON patient_access_requests (patient_id, provider_id)
    WHERE status = 'pending';
