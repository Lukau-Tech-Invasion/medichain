# Response to the external security review

**Date:** 2026-08-04. Every verdict below was checked against the code, and where
possible against a running server. Nothing here is accepted on the reviewer's
authority alone — and nothing is dismissed to protect the project.

## Summary judgement

**The review is substantially correct and should be acted on.** Its central
thesis — *"the enforcement mechanisms do not yet match the claims"* — is right,
and it is right for the precise reason it gives: authentication was repeatedly
mistaken for authorization. I had independently found the same class the day
before (HZ-024: four endpoints authorizing on a `0xPROV` wallet-address prefix,
reachable unauthenticated), which is corroboration, not coincidence.

Its most valuable contribution is **Finding 2 — that our own endpoint-auth gate
produced dangerous false assurance.** That criticism is exactly right, it is the
kind of thing internal work rarely catches about itself, and it has been fixed
first (see below). A green check that a release decision leans on is worse than
no check.

Where I disagree, I say so with evidence. Three verdicts:

| # | Claim | Verdict |
|---|---|---|
| 7 | "Current source does not compile — `IORecordEntity has no field is_active`" | **STALE — already fixed** |
| 1,2,3,5,6,9,10,11,12,13,14 | Authorization, checker, idempotency, fail-open, ports, isolation, rate limit, replay, offline PHI, jobs, metrics | **CONFIRMED** |
| Blockchain | node/runtime excluded, Dockerfile absent, no-op subcommands | **CONFIRMED** |

---

## Where the review is wrong or stale

### Finding 7 — "the source does not compile" — STALE

The reviewer hit `IORecordEntity has no field named is_active` at
`emergency/mod.rs:132`. That is a real error **I introduced and fixed earlier the
same day**, while replacing the non-persisting MAR/IO stubs: I wrote `is_active`
into a struct literal, the compiler rejected it, and I corrected it to
`verified_by`. The reviewer's snapshot caught the working tree mid-edit.

Current state, re-verified: `cargo test --bin medichain-api` → **311 passed, 0
failed**; `cargo fmt --check` clean; both frontends `tsc --noEmit` clean.

This matters beyond the single claim, because the review draws a conclusion from
it — *"the current dirty source cannot produce a verified new API image"* and
*"the API build is broken"* appears in the debt list and in the go/no-go table.
That inference no longer holds. **The rest of the review does not depend on it**,
and I have not used this to discount anything else.

### One overstatement worth naming

> "A forged, unregistered identity received HTTP 200 from multiple live endpoints.
> The database happened to be mostly empty, but that does not make the control safe."

The reasoning is correct and I agree with the conclusion. But on the specific
endpoints I tested the same day, the database was **not** empty — a forged
`X-User-Id: 0xPROVattacker` returned a synthetic patient's blood type, health ID,
national-ID hash, DNR and organ-donor status. The finding is **worse** than the
review states, not better.

---

## Fixed in this pass

| Review # | Issue | Fix |
|---|---|---|
| **2** | Auth checker passed handlers that merely *mention* `X-User-Id` | Replaced presence-detection with **5-tier classification** + a ratchet |
| **5** | Migration failure warned; DB failure fell back to volatile storage | **Fail closed** outside demo mode; both now abort startup |
| **3** | Idempotency cache keyed by the caller's raw string | Key is now `SHA3(subject ‖ method ‖ path ‖ key)`, length-prefixed |
| **6** | `ports: []` is a Compose no-op; Postgres/pgAdmin/IPFS still published | `!override` on all three; pgAdmin moved behind a `debug` profile |
| **10** | Any `X-User-Id` bought the authenticated quota; unbounded map growth | Elevated tier and per-user bucket now require a **resolved** user |
| **14** | `/api/metrics` public; unmatched paths → unbounded cardinality | Auth required (or `METRICS_TOKEN`); unmatched paths collapse to `<unmatched>` |
| — | `demo-login` auto-created accounts, `MEDICHAIN_DEV_MODE` defaulted **true** | Defaults to false **and** requires demo mode |
| — | `POST /api/insurance/cards` — any caller could file a card against any patient | Owner-or-provider check (HZ-020 fixed the other mutators, missed create) |

Two of those the review did not find. The tiered gate surfaced them within
minutes of existing — which is the argument for fixing the gate first.

### What the new gate reports

The old gate said `408 handlers, 0 unclassified, PASS`. The same codebase now
reports:

```
tier 4 — resource/patient scope authorization                      20
tier 3 — role authorization                                       182
tier 2 — registered identity resolved                              27
tier 1 — identity PRESENCE only (forged header satisfies it)      144
tier 0 — no auth decision                                           0
unscoped bulk reads (list_all without resource scope)              41
```

**144 presence-only handlers and 41 unscoped bulk reads** is the honest size of
the review's Finding 1. It is recorded as a ratchet baseline: the count may fall,
never rise, so the backlog cannot quietly grow while we work through it.

---

## Confirmed, not yet fixed — and why

These are real and I did **not** attempt them in this pass, because each is a
design change that must not be rushed under a demo deadline:

- **Finding 1 — the authorization chokepoint.** The correct fix resolves
  identity → organization → facility → role → treatment relationship → consent →
  resource scope, and pushes that scope *into the query*. Filtering after
  `list_all()` is not isolation. This is the single largest piece of work and the
  one that decides multi-hospital viability.
- **Finding 4 — process-local clinical state.** Confirmed: `AppState` holds
  dozens of `RwLock<HashMap<…>>` stores. The review is right that for MAR,
  critical results and emergency grants this is a **patient-safety** issue, not
  debt.
- **Finding 9 — hospital isolation.** Nullable facility ownership + 41 unscoped
  bulk reads. "They do not share patient data" is currently a product statement.
- **Finding 11 — signature replay.** No consumed-nonce ledger; a signed request
  is replayable inside the 5-minute window. Matters most for prescribing and
  medication administration.
- **Finding 12 — unencrypted offline PHI**, with two duplicate IndexedDB
  implementations.
- **Finding 13 — duplicated background jobs** under horizontal scaling.
- **Blockchain.** Confirmed: `node` and `runtime` are excluded from the workspace
  (`Cargo.toml:10`), `node/Dockerfile` does not exist, subcommands return
  `Ok(())`. **Do not describe this as blockchain-backed.** It is an
  API/PostgreSQL system with a planned Substrate commitment layer.

## I accept the release decisions

I have no evidence to contest any No-go. The one correction: the local API demo
is on firmer ground than the review implies, because the build works. That moves
nothing else.

## Method note

The review's discipline — *"I treated green tests as proof only of their
assertions, not proof of safety"* — is the right standard, and this project has
now been bitten twice by the inverse. Our e2e suite asserted a medication
administration succeeded against an endpoint that persisted nothing, and the
auth gate asserted 408 handlers were safe when 144 accept a forged header. Both
were green. Green is a coverage claim, never a safety claim.
