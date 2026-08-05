# MediChain — Where We Actually Are

**Assessed 2026-08-04.** Every number below was produced by running the thing,
not by reading a previous document. Where a prior doc disagreed, the prior doc
was wrong and is corrected here.

## Short answer

The system is **not 1–5% from finished**, and the gap is not evenly spread.
The *core* is genuinely strong: registration, emergency capsule, consent
records, retention, encryption, IPFS round-trip, RBAC and the auth model are
real, repository-backed and tested. What is not finished is a **thin outer
band of endpoints that look implemented and are not**, plus a set of
**verification gaps** where a control was never actually exercised.

Honest completion estimate for a **credible synthetic demo**: ~90–95%.
Honest completion estimate for **real patient data**: much further out, and
that distance is legal and architectural, not a matter of finishing screens —
see "The POPIA wall".

## Verified green (ran today)

| Check | Result |
|---|---|
| API unit tests | **311 passed, 0 failed** |
| Synthetic e2e (live server, 11 sections) | **83 passed, 0 failed** |
| Cross-patient IDOR sweep (33 endpoints) | **0 leaks** |
| Endpoint-auth CI gate | **408 handlers, 0 unclassified** |
| `cargo fmt --check` | clean |
| Doctor-portal + patient-app typecheck | both clean |
| Route drift (74 page paths vs 391 routes) | **0 real drift** after today's fixes |

## Fixed today

1. **Unauthenticated cross-patient PHI disclosure (HZ-024) — critical.**
   Four endpoints authorized by *wallet-address prefix*
   (`current_user_id.starts_with("0xPROV")`). Since `X-User-Id` is
   caller-supplied, `curl -H "X-User-Id: 0xPROVattacker"` — no account, no
   registration — returned **200 with real PHI** from
   `/api/sync/download/{id}` (blood type, health ID, national-ID hash, DNR,
   organ-donor status), `/api/consent/patient/{id}` and
   `/api/medications/reminders/{id}`. A legitimate unrelated patient account
   correctly got 403, which is why nothing had caught it. Fixed at all four
   sites by resolving the role from the user store; retested attacker→403,
   doctor→200.

   *Why the existing sweep missed it:* `idor-sweep.sh` attacks as a registered
   patient with an ordinary SS58 address. The vulnerable branch needs an id
   whose **text** begins `0xPROV`. Coverage was being measured in endpoints,
   never in credential *shapes*.

2. **Fabricated clinical data served as real (HZ-023) — high.**
   `/api/symptoms/{patient_id}` returned invented chronic conditions —
   *Hypertension*, *Type 2 Diabetes* — for **any** patient id.
   `/api/barcode/{id}/history` returned an invented specimen chain of custody
   naming "Dr. Smith", "Nurse Jones", "Lab Tech Brown". Plus a mock message
   inbox and mock scan history. None was gated; all ran identically in
   production mode. Contained by gating all four behind `require_demo_mode()`
   (403 outside demo). **The features remain unimplemented** — this stops the
   lying, it does not finish them.

3. **Two emergency pages were 404ing.** StrokePage and TraumaPage still called
   the removed `/api/clinical/patient/{id}/emergency`; the earlier pass fixed
   CodeBlue and Sepsis but missed these two.

4. **HZ-021 patient-facing copy** (earlier this session) — the Consent screen
   claimed a revoked provider "will no longer be able to view your medical
   records", which is false; corrected, plus both bundles rebuilt.

## Placeholders — ALL REMOVED 2026-08-04

Every fabricating or non-persisting endpoint identified above has been replaced
with a real implementation. Three new stores were added
(`messages`, `symptom_entries`, `barcode_scans` — migration
`20260804000001_hz023_real_stores.sql`), registered in both the memory and
PostgreSQL backends.

| Endpoint | Was | Now |
|---|---|---|
| `POST /api/messages/send` | built a message, stored nothing | persists an inbox copy (recipient) and a sent copy (sender) |
| `GET /api/messages` | two invented messages for everyone | reads the real store; returns `messages` **and** `conversations` |
| `POST /api/symptoms/log` | built an entry, stored nothing | persists to `symptom_entries` |
| `GET /api/symptoms/{id}` | invented *Hypertension* + *Type 2 Diabetes* for any id | returns the entries actually logged |
| `POST /api/barcode/scan` | invented a patient name per barcode prefix | records a real scan; reports the entity as **unresolved** rather than guessing |
| `GET /api/barcode/{id}/history` | invented custody by "Dr. Smith"/"Nurse Jones" | assembled from recorded scans; unscanned ⇒ empty |
| `GET /api/barcode/scans/my` | fixed invented list | the caller's real scans |
| `POST /api/nursing/mar/administer` | `success:true`, nothing written | appends the dose to the patient's MAR |
| `POST /api/nursing/intake-output/record` | `success:true`, nothing written | routes the volume to its column, recomputes totals |
| `POST /api/emergency/administer-med` | `success:true`, nothing written | shares the MAR writer |
| `POST /api/emergency/record-fluid` | `success:true`, nothing written | shares the I/O writer |

The demo-mode gates added earlier as containment were **removed** — they exist
to stop fiction reaching production, and there is no longer any fiction to stop.

Two deliberate non-inventions, because the honest answer is "we don't know":
- **Chronic conditions are not synthesised** from logged symptoms. Nothing in
  the diary establishes a diagnosis; inferring one would recreate the original
  defect in a subtler form.
- **Barcode entity lookup is reported as unresolved.** The barcode's text can
  honestly indicate its *kind*; it cannot name a patient or a drug. A registry
  lookup does not exist yet, and the response says so.

Verified by 14 new round-trip assertions (suite is now **101 passing, 0
failing**) that assert what comes back is what went in, and that an untouched
entity comes back **empty** rather than populated.

### Consent enforcement (HZ-021) — architectural
Patient access grants are recorded, audited and displayed but **consulted by
zero authorization paths**. Approving grants nothing; revoking removes
nothing. The real fix collides with the HZ-010 chokepoint problem: authz is
per-handler across 408 handlers, so a new global rule has nowhere to attach.
Needs an owner decision, and care that revocation cannot lock out emergency
access.

### In-memory-only stores
`patient_access`, `emergency_grants`, `mobile_records`, surgical documents —
lost on restart under `MEDICHAIN_STORAGE=postgres`.

## Verification gaps — things believed working but never exercised

These matter more than the feature gaps, because each is a control we would
*claim* works.

1. **The PostgreSQL path has never completed an end-to-end run.** Blocked on
   Docker Desktop, down for multiple sessions (`dockerDesktopLinuxEngine` pipe
   missing). All e2e evidence is memory-backend.
2. **Retention execution has never acted on a real due record.** All 10
   policies ship inactive by design, so execution has only ever run over an
   empty set.
3. **Backup/restore has never been rehearsed** (`BACKUP_RESTORE_RUNBOOK.md`).
4. **Metric content unverified** — the endpoint returns 200 but exports no
   `medichain_`-prefixed series.
5. **No frontend render check.** Everything is verified at the API boundary.
   Pages are known to *reach* correct endpoints and parse tolerantly; no one
   has confirmed a browser actually renders the lists.
6. **Frontend does not consume SSE** — zero `EventSource` consumers, so the
   working real-time backend is unused.
7. **No independent security retest.** HZ-001..024 are all self-retested by
   the agent that wrote the fix.

## The POPIA wall

Separate from engineering completeness and **not closable by writing code**:
`docs/PRODUCTION_READINESS_GATES.md` lists 7 items gating real patient data;
items 5–7 are not engineering tasks. The blood-type / organ-donor / DNR
on-chain plaintext exception (HZ-003) is accepted **only** for synthetic data —
before real data touches those fields they need commitment-hash + off-chain
encrypted capsule + break-glass. Plan for a synthetic-data demo; do not plan
for real patients without that work.

## What I would do next, in order

1. **Add a forged-credential case to `idor-sweep.sh`** (`0xPROV*`, `0xDOC*`,
   unregistered ids). Today's critical bug would have been caught on day one by
   ~10 lines. Highest value per effort in the whole list.
2. **Regression tests for HZ-023/HZ-024** — neither is test-covered; both were
   verified by hand.
3. **Get Docker up** and run the Postgres e2e once. It is the single largest
   unverified surface and it also unblocks the Horizon active gate
   (rollback/monitoring/kill-switch rehearsal).
4. **Decide, per placeholder endpoint: implement or remove.** Do not ship them
   as "working".
5. **Owner decision on HZ-021 consent enforcement.**
6. **One browser pass** over the connected pages.

## Note on this document

Prior status docs overstated completion in both directions —
`FRONTEND_BACKEND_CONNECTION.md` said "Remaining: **none**" while two pages
were still 404ing, and the debt register described `patient_access` as
"correct for the synthetic/demo backend" when its grants are enforced nowhere.
Treat any completion claim here as valid only for 2026-08-04, and re-derive
rather than inherit it.
