# ADR-0007: One organisation per instance, and what that means for bulk reads

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Founder
- **Extends:** [ADR-0006](0006-federated-deployment.md)

## Context

`scripts/check-endpoint-auth.py` reports 38 handlers that call `list_all()`
without a resource-scope predicate — clinician worklists (critical values,
pending lab submissions, code blues), the role dashboards, and the
`/api/platform/list/*` registries behind `require_registry_reader`.

`FEATURE_END_TO_END_AUDIT.md` carried these as an open **cross-organisation
exposure risk**, with a note that closing them "properly is an architectural
change": adding an organisation column to ~40 clinical tables, backfilling it,
resolving the caller's organisation through the `organization_assignments`
schema, and pushing a tenant predicate into every query.

That framing had the question backwards. Whether those reads are a defect
depends entirely on how many organisations share one database — and
[ADR-0006](0006-federated-deployment.md) already answered that: **each hospital
runs its own MediChain instance, with its own PostgreSQL.** The federation
boundary is the deployment, not a column.

So the reads were never unscoped. Their scope is the instance.

## Options considered

**A. Add tenant scoping to ~40 clinical tables.** Genuinely necessary *if* one
instance ever serves two hospitals. Rejected here: it contradicts ADR-0006,
touches nearly every clinical query, and would add a predicate that is
tautologically true in every deployment the architecture permits — cost and
regression risk with no security gain.

**B. Leave the finding open.** Rejected. An open "exposure risk" that is not one
trains reviewers to ignore the gate, and the next real finding gets ignored with
it.

**C. Record the boundary and enforce it.** *(chosen)*

## Decision

**One organisation per API instance.** A deployment-wide read is the intended
scope of a clinician worklist: a doctor is supposed to see every critical value
in their hospital, and a registry reader is supposed to see the hospital's
registry.

Two consequences follow, and both are enforced rather than assumed:

1. **Startup refuses a multi-organisation database.** If the `organizations`
   table holds more than one active row, the instance fails to start with an
   explicit message. Running two hospitals against one instance would expose
   each one's registries to the other, and that must be impossible by accident
   rather than merely discouraged.
2. **The auth gate reports these reads as a recorded decision**, not as an
   unresolved risk, and names this ADR. The count is still printed, so the
   number growing is still visible.

## Consequences

**Gained.** The security question is answered rather than deferred, and the
answer is checked at startup instead of living in a document. The endpoint-auth
gate becomes trustworthy again: everything it still flags is something to act
on.

**Cost.** MediChain cannot serve two organisations from one instance without
revisiting this decision — which is the same constraint ADR-0006 already
imposed, now made explicit and enforced. A hosted multi-tenant offering for
small clinics would need option A, and this ADR should be superseded rather than
worked around. The `organizations`, `facilities`, `professional_identities` and
`organization_assignments` tables remain the right foundation for that work.

**Not changed.** Per-patient authorization is unaffected. Every handler that
touches one patient's record still resolves the caller against that record;
this ADR is only about reads whose intended scope is the whole instance.
