# ADR-0006: Federated per-hospital deployment

- **Status:** Accepted
- **Date:** 2026-03 (recorded retrospectively 2026-07-29)
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

These two requirements — no hospital gives up custody, yet records must move —
appear contradictory. Resolving them is the core architectural decision.

## Options considered

**A. Central cloud platform.** Simplest to build and operate. Rejected: it is the
model that has already failed here, for reasons that have not changed.

**B. Point-to-point integrations between hospitals.** No central owner. Rejected:
integration cost grows quadratically and there is no shared basis for identity,
consent or audit.

**C. Federation over a shared trust layer.** *(chosen)* Each hospital keeps its
data; a blockchain carries only identity, consent and audit.

## Decision

Each hospital runs its **own** MediChain instance — its own API servers, its own
PostgreSQL, its own IPFS node holding its own encrypted documents, and its own
Substrate node on the shared network. Data never leaves the hospital's
infrastructure.

The chain carries only what must be *shared*: identity, consent grants, and audit
entries — enough to locate and release a record, never enough to take one.
Consensus is proof-of-authority with the Ministry of Health and major hospitals as
validators, so authority rests with the state rather than a vendor. Smaller clinics
that cannot run infrastructure use a hosted instance on the same network.

Cross-organisation release uses encrypted envelopes: Hospital A can create an
envelope readable by Hospital B without either private key touching the database
or the chain.

## Consequences

**Gained.** Adoption is possible one hospital at a time, with no national
big-bang procurement and no custody surrender. It removes the objection that
stalled previous efforts. It is also a structural moat: an incumbent whose
business model is *being the centre* cannot match it without abandoning that model.

**Cost, and it is substantial.** Operationally far harder than a central service:
per-instance upgrades, key lifecycle and rotation, device enrolment, schema
migration across independently-operated deployments, and debugging across
organisational boundaries. Support burden scales with the number of operators, not
users. A hospital that misconfigures its instance is a hospital we cannot directly
fix.

**Verification status — stated honestly.** Federation invariants are implemented
and unit-tested. They have **not** been validated as full scenarios against a live
multi-node deployment: key lifecycle, grant binding and expiry, device revocation,
and legacy record compatibility remain to be proven end to end. Tracked in
[`FEDERATION_TEST_READINESS.md`](../FEDERATION_TEST_READINESS.md). Compiling is not
evidence.

**Open compliance question.** Chain nodes may run in more than one country, which
POPIA treats as transborder processing requiring assessment. See
[`GOVERNANCE_RECORD.md`](../GOVERNANCE_RECORD.md).
