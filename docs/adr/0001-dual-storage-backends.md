# ADR-0001: Two storage backends behind one repository trait

- **Status:** Accepted
- **Date:** 2026-01 (recorded retrospectively 2026-07-29)
- **Deciders:** Founder

## Context

A clinical system needs PostgreSQL: indexes, joins, transactions, reporting. But
requiring a running database to start the API makes every demo, every test run
and every fresh clone a provisioning exercise. For a solo developer evaluating
changes dozens of times a day — and for anyone assessing the project — that cost
compounds.

## Options considered

**A. PostgreSQL only.** One code path, no divergence risk. Rejected: nothing runs
without Docker, and tests become slow and order-dependent.

**B. SQLite for dev, PostgreSQL for production.** Rejected: SQL dialect
differences mean the dev path exercises different behaviour than production —
divergence with none of the honesty of an explicitly different implementation.

**C. In-memory implementation of the same traits.** *(chosen)* Both backends
satisfy `repositories::traits`; selection is `MEDICHAIN_STORAGE=postgres`.

## Decision

Every repository is a trait. Two implementations: `repositories::memory` (default,
ephemeral) and `repositories::postgres` (production). Handlers depend on the trait,
never on a concrete backend.

## Consequences

**Gained.** `cargo run` works on a clean machine. Tests run in milliseconds with
no fixture teardown. The in-memory backend doubles as the demo environment, and
its ephemerality is a *security property* for testing: the kill switch is killing
the process, and rollback is restarting it.

**Cost — and it is real.** Two implementations of one contract will drift. This
is not hypothetical: a double-revoke bug was found where the emergency-capsule
memory backend accepted a second revoke and overwrote the original revocation's
attribution, while PostgreSQL correctly refused it. The guard had been written as
SQL (`AND revoked_at IS NULL`) instead of as part of the trait's contract, so the
second implementation had nothing to implement against.

**Mitigations adopted.** Behavioural rules belong in the trait's doc comment, not
only in SQL. The same tests must run against both backends. And crucially: the
in-memory-only test suite is *not* sufficient evidence — the PostgreSQL path must
be exercised through HTTP, because that is where the divergence surfaced.
