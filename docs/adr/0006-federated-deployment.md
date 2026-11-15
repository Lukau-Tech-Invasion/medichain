# ADR-0006: Federated per-hospital deployment

- **Status:** Accepted
- **Date:** 2026-03 (recorded retrospectively 2026-07-29; revised 2026-09-29)
- **Deciders:** Founder

## Context

South Africa has attempted health-record digitisation before. The documented
reasons it stalled were not primarily technical: fragmentation, lack of
interoperability, and — decisively — unwillingness to place patient data in a
central system owned by someone else, reinforced by POPIA obligations that make
that reluctance rational rather than merely political.

Every centralised EHR asks a hospital to surrender custody of its records. That
request is what stalls, and the country stays on paper.

Meanwhile a patient's record must be locatable and releasable across facilities,
or the system solves nothing.

## Options considered

**A. Central cloud platform.** Simplest to build and operate. Rejected: it is the
model that has already failed here, for reasons that have not changed.

**B. Point-to-point integrations between hospitals.** No central owner. Rejected:
integration cost grows quadratically and there is no shared basis for identity,
consent or audit.

**C. Federation of independent instances.** *(chosen)* Each hospital keeps its
data and its own audit stream; trust between organisations is established with
organisation signing keys and exchanged signed checkpoints.

## Decision

Each hospital runs its **own** MediChain instance — its own API servers, its own
PostgreSQL and encrypted document store, and its own sealed audit stream and
signing key (ADR-0010). Data never leaves the hospital's infrastructure.
Smaller clinics that cannot run infrastructure use a hosted instance.

Cross-organisation release uses encrypted envelopes: Hospital A can create an
envelope readable by Hospital B without either private key touching the
database. Where one organisation must trust another's audit record, it verifies
the other's signed checkpoints against that organisation's published key.

## Consequences

**Gained.** Adoption is possible one hospital at a time, with no national
big-bang procurement and no custody surrender.

**Cost, and it is substantial.** Operationally harder than a central service:
per-instance upgrades, key lifecycle and rotation, device enrolment, schema
migration across independently operated deployments, and debugging across
organisational boundaries. Support burden scales with the number of operators,
not users.

**Verification status — stated honestly.** Federation invariants are
implemented and unit-tested. They have **not** been validated as full scenarios
across live independent deployments: key lifecycle, grant binding and expiry,
device revocation and record compatibility remain to be proven end to end.
Tracked in [`FEDERATION_TEST_READINESS.md`](../FEDERATION_TEST_READINESS.md).
