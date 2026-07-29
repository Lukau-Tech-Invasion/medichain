# Technical Debt Register

> **SEQUENCING — READ THIS FIRST.**
>
> **Nothing in this file is to be actioned yet.** The owner's instruction
> (2026-07-29) is that dead-code removal and debt paydown happen **last**, once
> the full application is implemented and tested — because you cannot tell what
> is genuinely unused until the whole thing works. Deleting something today that
> a not-yet-finished feature was going to call is exactly the mistake this
> ordering prevents.
>
> This register **records** debt as it is discovered so the evidence is not lost
> and does not have to be re-derived. It does **not** authorise removing any of
> it. CLAUDE.md rule 7 still applies: never delete code without asking.
>
> **When the cleanup pass finally runs, work this file top to bottom.**

Last updated: 2026-07-29.

---

## How this list was produced

Mostly by the compiler, which is the point. `cargo check`'s dead-code warnings
are the cheapest reliable detector of "written but never wired", and this
project has already been bitten by the difference between *the module exists*
and *the requirement is implemented* — see the HZ-003 emergency capsule, which
was 324 well-tested lines with zero callers while a status table called it
"Implemented".

Re-run before actioning anything, since the list will have moved:

```bash
cargo check -p medichain-api --message-format short 2>&1 | grep warning
cargo clippy -p medichain-api --all-targets
```

---

## 1. Tests that do not run — HIGHEST VALUE, fix before anything is deleted

`tests/integration_tests.rs` (902 lines, 28 tests) and `tests/e2e_tests.rs`
(672 lines, 21 tests) sit at the repository root. The root `Cargo.toml` is a
**virtual workspace** — its `members` are `pallets/*`, `crypto`, `api`, and it
is not itself a package. Rust only builds `tests/` for a package, so these
files belong to nothing and are **never compiled or executed**.

Confirmed 2026-07-29:

```
$ cargo test --test integration_tests
error: no test target named `integration_tests` in default-run packages
```

`CLAUDE.md` nonetheless documents both commands and claims "28+ tests" and
"18+ tests" as part of the suite. **49 tests across 1,574 lines have never
run.**

Why this is first: it is not dead code to delete, it is coverage to *recover*.
Any deletion pass is safer with those tests running, and they may well be
asserting behaviour that a later cleanup would otherwise break silently. Also,
some of them may no longer compile — 1,574 lines have been drifting against a
moving codebase with no compiler checking them.

**Action when the time comes:** decide whether these move under `api/tests/`,
get their own workspace member, or are retired. Do not assume they still pass;
find out. Then correct CLAUDE.md's testing section either way.

---

## 2. Dead modules and unused items (compiler-identified)

Each entry is a *candidate*, not a verdict. Confirm no live caller, and confirm
no in-flight feature intends to call it, before proposing removal.

### `api/src/key_management.rs` — entire module appears unused

Pre-existing (commit `78d44e4`), untouched by the current work. Every public
item is flagged:

- `struct EncryptionContext` — never constructed
- `struct RecipientPublicKey` — never constructed
- `struct GeneratedDataKey` — never constructed
- `struct KeyEnvelope` — never constructed
- `trait KeyManager` — never used
- `struct LegacyDeploymentKeyringAdapter` — never constructed

Note it sits next to `encryption_keyring.rs`, which *is* live and is what the
codebase actually uses. This looks like a superseded design. **Check whether it
was intended as the envelope-encryption path for a planned feature before
retiring it** — an unused key-management abstraction is the kind of thing
someone builds deliberately ahead of need.

### `api/src/middleware/rate_limit.rs` — partially dead

- `struct RateLimitEntry` — never constructed
- `struct RateLimitMiddlewareService` — never constructed
- `fn get_client_identifier` — never used
- `fn get_rate_limit` — never used

Rate limiting is a security control. If this module is dead, the question is
not "can we delete it" but **"is rate limiting actually enforced anywhere?"**
Answer that first; the answer may be a finding rather than a cleanup.

### Smaller items

- `api/src/repositories/traits.rs` — two `parse` associated functions never
  used (~lines 6139, 6181). Likely the read-back half of an enum whose write
  half is used. Harmless, but check the pair is not half-wired.
- `api/src/retention/evaluator.rs:90` — `RetentionDecision::kind()` never used.
  Written for a reporting surface that was not built.

---

## 3. Clippy: functions with too many arguments

- `api/src/emergency_grants.rs:60` (10 args)
- `api/src/emergency_grants.rs:110` (9 args)
- `api/src/telehealth_retention.rs:45` (8 args)

All pre-existing. These are genuine readability debt — a 10-argument call site
is easy to transpose. Candidate fix is a parameter struct, not a suppression.

Note: `emergency_capsule::log_access` also takes 9 and carries an explicit
`#[allow(clippy::too_many_arguments)]`. If a parameter-struct convention is
adopted, apply it there too rather than leaving one allow-listed exception.

---

## 4. Schema debt

### The `sessions` table has zero live queries

Flagged during Horizon `HZ-WP8-PRIV-001`'s data-minimisation review:
authentication moved to stateless JWT and nothing reads or writes this table.
It holds PII-shaped columns, so keeping it is a data-minimisation problem, not
just clutter.

**Deliberately not dropped** — a schema change needs the owner's sign-off
separately from a code-deletion pass. Still open.

### Migration count vs. reality

179 tables exist in a freshly migrated database. Whether all are reachable from
live code is unknown. Worth a systematic pass at cleanup time: cross-reference
table names against `api/src/repositories/` to find orphans.

---

## 5. Documentation drift

- `CLAUDE.md`'s testing section documents two test commands that cannot run
  (item 1) and test counts that are not real.
- `CLAUDE.md`'s "Current State" section predates this campaign's work in
  several places (e.g. blockchain description was corrected once already during
  HZ-002; the retention and capsule entries now need the same treatment).
- `deny.toml` retains the `RUSTSEC-2024-0363` (sqlx) entry, now resolved and
  kept only for legibility — fine, but re-check at cleanup time whether the
  4 rustls-webpki advisories have upstream fixes by then.
- `IMPLEMENTATION_PLAN.md` has a documented history of stale done/blocked
  claims in both directions. Treat every status marker as a hypothesis.

---

## 6. Environment / build debt

Not code, but it costs real time every session:

- Builds repeatedly fill the C: drive to 0 bytes, producing **misleading
  linker errors** that look like code faults. `target/debug/incremental` alone
  reached 3.3 GiB. Current mitigation: `CARGO_INCREMENTAL=0` and periodic
  `cargo clean`.
- The API's default port (8080) collides with the documented IPFS gateway port
  (8080); `docker-compose.yml:111` already notes it. This actively caused a
  misdiagnosis during the 2026-07-29 kill-switch rehearsal, where a 404 from
  Docker's port proxy was briefly read as "the API is still running".
  Candidate fix: move the API's default off 8080.

---

## Explicitly NOT debt

Recorded so a future cleanup pass does not "tidy" away something load-bearing:

- **`emergency_capsule.rs`'s unused-looking provenance fields** — `BloodTypeSource`,
  `blood_type_verified_at/by`, `dnr_document_ref`. They are part of the
  committed digest and the POPIA gate §1 spec, and are deliberately carried
  even when currently `None`.
- **The two `#[serde(rename = ...)]` attributes on `ConsentGiverCapacity`.**
  They look redundant beside `rename_all = "snake_case"`. They are not —
  removing either silently breaks the wire/storage contract and disables the
  Children's Act §129 checks. See finding HZ-015; there is a regression test.
- **Reserved pallet call indices 2 and 3** in `pallet-medical-records`. They are
  intentionally left unused so a stale client cannot bind to a different
  extrinsic. Reusing them is a correctness bug, not a tidy-up.
- **`retention::execution` stopping short of deletion.** The absence of
  destructive code is the design, not an unfinished feature.
