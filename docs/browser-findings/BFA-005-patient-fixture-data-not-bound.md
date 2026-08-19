# BFA-005 — Patient demo wallet does not prove binding to its intended fixture

## Status

Candidate functional defect. Reproduced on 2026-08-19.

## Evidence

The source labels wallet `...S60Z` as `Thabo (Cardiac)`. Signing in through
the running patient portal succeeds but the dashboard renders `Hello, Pat`, a
generated `PAT-...` health ID, unknown blood type, and zero allergies and
medications. The visible Records screen reports `0 records found`.

This may be a broken wallet-to-patient link, a seed mismatch, or an intentional
empty-state fallback. The user interface does not distinguish those cases, so
the intended patient fixture cannot be verified from the browser.

## Fix strategy

Trace the API response for `/api/auth/wallet/{address}` and the dashboard/record
requests through the repository. Establish one authoritative fixture mapping.
Return a typed, explicit no-linked-record state when a wallet exists but lacks
a patient link; do not render a fabricated name or health ID. Seed the browser
test profile with a named patient, expected demographics, one record, and one
consent state.

## Acceptance criteria

- The fixture wallet maps to the expected patient ID in the API and database.
- Dashboard identity, health summary, and Records screen read the same patient.
- An unlinked wallet produces a distinct, accessible recovery message.
- An automated browser test asserts the fixture values and durable API read-back.
