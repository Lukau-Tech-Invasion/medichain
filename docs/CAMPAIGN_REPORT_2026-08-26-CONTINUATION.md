# MediChain completion campaign — 2026-08-26, second pass

Continues `docs/CAMPAIGN_REPORT_2026-08-26.md` from commit `6180f3a`. That
report closed with the authentication spine proven and most of the rest of the
system "asserted rather than demonstrated". This pass went after the
demonstration, and demonstrating things broke several of them.

Nothing here is carried over. Every result was produced against this source, a
live API and a real PostgreSQL 16 database.

## A. What state the previous session actually left

The working tree was clean at `6180f3a` and the ledger was accurate except in
one place: `SC-002` was recorded `STILL PRESENT` and was in fact closed.
`cargo deny check` exits 0 across the root workspace. The policy was audited
rather than taken at face value — every ignore is a per-advisory reachability
judgement with a stated reason, the two upstream acceptances name a removal
criterion, the single licence exception is crate-scoped, and both
`unused-ignored-advisory` and `unused-license-exception` are `deny`, so the
list cannot describe a graph it no longer matches. No blanket ignores.

The running Docker image was **stale** — `/api/auth/demo-credentials` is
registered unconditionally in source and returned 404 live, which is only
possible from an image predating HEAD. Every runtime result below comes from a
locally built current-source API on `:8090`, not that image.

## B. Findings

Fifteen, all fixed or explicitly deferred, all committed. Every regression test was **falsified against
the unfixed code before being kept**; where that failed, it is said so.

### Clinical state machines

**APP-002 — lab approval was not a maker-checker control.** Three faults in one
workflow. `/api/lab/submit` accepts Doctor, Nurse and Admin and `/api/lab/review`
accepts the same three, so the clinician who filed a result could approve it —
the four-eyes property the review exists to provide was satisfiable by one
person acting twice. The review then read the submission, checked `status ==
Pending` and wrote it back with an unconditional upsert, so two concurrent
reviews both committed and the later silently replaced the earlier decision,
including replacing an approval with a rejection. And on approval, a failed
medical-record write was logged and ignored while the caller was told
"approved and added to patient records".

`replace_if_field_eq` gives these tables the state-machine primitive they
lacked — the guard expressed inside the write, in both backends, matching the
shape retention approvals already used (`WHERE status = 'pending' AND
requested_by <> $3`). The record and audit writes are obligations now: a
failure reverts the transition and returns 503.

**APP-003 — the prescription lifecycle had no states.** A prescription already
transmitted to a pharmacy could be re-signed, replacing the signature and
walking `status` backwards from `Transmitted` to `Signed`, so the record denied
a transmission that had happened. Transmission checked `status == Signed` then
wrote unconditionally, so two concurrent calls both committed — a prescription
a pharmacy may dispense twice. All three writes were `let _ = ...create(...)`,
returning 201 with an id for a record that may not exist. No lifecycle event
was audited at all. The e-signature attested `ip_address: "127.0.0.1"` and
`user_agent: "MediChain/1.0"` as literals whatever the request's real origin —
invented provenance in a record that reads as evidence.

### The audit trail

**AUD-002 — lab-review audit had never worked on PostgreSQL.**
`lab_review_approve` and `lab_review_reject` have been written by
`/api/lab/review` since it existed and were never in the
`access_logs_action_check` vocabulary. Every audit row had always been
rejected; the insert discarded its own error, and the in-memory backend used by
the tests enforces no CHECK constraints. It surfaced as a 503 the moment the
write became an obligation — not a regression, the first time an always-present
failure could be seen.

The existing guard test could not have caught it. It hand-mirrors the
constraint and proves `list == constraint`; the invariant that matters is that
the constraint covers what the handlers write, and a value missing from both
satisfies that test perfectly. `scripts/check-audit-action-vocabulary.py` reads
the written side from the Rust source, resolves literals and `const`
references, and **fails on any expression it cannot evaluate** rather than
skipping it — which is what surfaced the prescription helper's
`event.to_string()` that a literals-only version walked past.

### The screens

These three were invisible to 61 passing API checks and would have stayed
invisible however many more were added. They took opening the browser.

**UI-001 — the lab approval workflow had no user interface.**
`getPendingLabResults` and `reviewLabResult` had been exported from the shared
client the whole time, called by nothing. A lab technician could file a result
and no clinician could see or sign off on it anywhere in the product.

**UI-002 — the "Pending Lab Reviews" tile was structurally always zero.** It
read `lab_submissions` — the lab *order* store written at specimen collection,
whose statuses are `collected` and friends — and filtered for `"pending"`,
which that domain never produces. The results awaiting signature live in
`lab_result_submissions`, one letter away. Live: tile 0, `/api/lab/pending` 8.

These two are mutually concealing. The number agrees with the absence of a
screen, and the absence of a screen means nobody ever checks the number. Either
alone might have been noticed in use; together they are silent.

**UI-003 — both access-log views returned nothing.**
`Pagination::new(page, per_page)` was called with the page size first and an
offset second, so the endpoint's own defaults (page=1, limit=20) became
`Pagination::new(20, 0)`, and a page size of 0 means `.take(0)`. The response
said so and nobody read it: `total_items: 54` beside `access_logs: []`. This is
the POPIA transparency control — how a patient learns who has read their
record. Found while checking that a lab approval had been audited: the audit row
existed and the endpoint reported none.

**UI-004** — `getPendingLabResults()` declared the server's `{submissions,
total}` envelope as its return type while `ApiClient.get` unwraps that to a
bare array. TypeScript cannot catch it; the unwrap is a runtime cast.

**UI-006 — a nurse's task list was invented.** The "Tasks Due" panel was four
hardcoded rows: a dressing change in `'Room 403'`, an IV site assessment in
`'ICU-2'`, and two rows interpolating the real `vitals_due` count into fixed
08:00 and 09:00 slots. Those times, those locations and those two tasks exist
nowhere in the backend — `/api/dashboard/nurse` returns `tasks.vitals_due` and
a hardcoded `ivs_to_check: 0`. With nothing outstanding a nurse saw "Vitals x0"
and "Blood sugar x0" listed as scheduled work beside a room number nobody
chose. A task list is a work instruction, so this is worse than a wrong tile: a
nurse either acts on a fabricated row or stops trusting the panel, and the
screen causes both. No placeholder audit would find it — "Room 403" matches no
keyword.

**UI-007 / UI-008 — two screens could not name the patient.** The pharmacist's
verification queue mapped `patient_name` out of the prescription document, and
`EPrescription` has no such field, so the column showed `PAT-6381aba1` where a
name belongs — to the person checking the order against an allergy list. The
laboratory's rejected-specimen panel reads `accession_number` and
`patient_name`; `SpecimenRejectionEntity` has `specimen_id` and `patient_id`
and neither of the others, so every rejection read "Unknown - Haemolysed sample
/ Patient: Unknown". Both now resolve the name once per distinct patient — it
is encrypted at rest, so each lookup costs a decrypt.

**UI-009 — the Notify / Request Recollect buttons are dead**, with no handler
and no endpoint to call. `SpecimenRejectionEntity` carries
`notified_ordering_provider`, `notification_sent_at`, `recollection_required`
and `recollection_scheduled`, so the model anticipates the workflow and nothing
sets them. Not built: who is notified, by what channel, and how a recollection
is scheduled are clinical governance decisions.

**UI-005 — patient wallet sign-in could not succeed for anyone.**
`signMessage()` called `web3Accounts()` without the required once-per-page
`web3Enable()` handshake, so polkadot-js threw its internal error and the
patient was shown that string as the explanation. `connectRealWallet()` does
perform the handshake but nothing on the sign-in path calls it. Both the
address form and all five quick-login buttons failed identically — with or
without an extension installed.

### Supply chain

**SC-001** — one advisory genuinely fixed rather than accepted: a precise
lockfile bump moved `h2` 0.4.15 to 0.4.19 and RUSTSEC-2026-0258 left the tree.
The remaining five cannot move, and each acceptance quotes the constraint
`cargo update --precise` reports: `sc-tracing v47.0.0` requires
`tracing-subscriber = "=0.3.19"`, an exact pin; `litep2p v0.14.3` requires
`hickory-proto = "^0.25"`, making the fix a semver-major step for the
dependent. `cargo tree -p medichain-runtime -i <crate>` establishes that
`hickory-proto`, `fxhash` and `proc-macro-error2` are absent from the on-chain
runtime's graph and reach only the node binary. The CI gate moved from
report-only to **enforced**, and `unused-ignored-advisory = "deny"` is on.

### Test infrastructure

**QUAL-001** — Pharmacist and LabTechnician had no fixtures, so neither role
had ever been exercised. Both are now seeded, with a second Doctor (every
maker-checker workflow refuses self-approval, so one clinician cannot exercise
one) and a second patient (with one patient you can only ask whether a
clinician reaches *a* record, which passes whether or not the boundary exists).

The seeder itself could not run: authenticated mutations need an
`Idempotency-Key` and the middleware requiring it landed after the script was
written; the failure was reported as "that employee identifier is already in
use" because the branch read `res.json.code` while the server nests errors
under `error.code`, making the condition really "any 409". A lazy
`await import('@polkadot/util-crypto')` raced vite-node's teardown on Windows.
The manifest was written relative to the process's working directory, which has
to be `client/`, so it landed in the wrong place.

There is deliberately **no EmergencyResponder fixture**. `Role` has six variants
and that is not one of them: break-glass is a capability reached through
`POST /api/emergency/access`, which requires an `nfc_tag_id` and so binds itself
to physical possession of the card.

## C. Evidence

### Cross-role qualification — `scripts/cross-role-qualification.ts`

**63/63, three consecutive runs against one server and one database.** Every
session comes from the real credential flow — employee identifier and password,
keystore opened client-side, signer derived, single-use challenge signed, JWT
issued; patients start a step later from their mnemonic. **No probe sends
`X-User-Id`.**

| Section | Covers |
| --- | --- |
| A | All six roles authenticate and receive a bearer token |
| B | Admin surface refuses Doctor, Nurse, Pharmacist, LabTechnician; admits Admin |
| C | Pharmacist and lab dashboards; pharmacist refused lab review |
| D | Lab workflow across three people; chart read-back; audit read-back |
| E | Maker-checker where both parties *can* review — submitter refused, second doctor succeeds |
| F | Fabricated, SQL-quoted and traversal ids; break-glass without NFC; unauthenticated; forged token |
| G | Prescription lifecycle: pharmacist refused, double-sign, double-transmit, re-sign after transmit |
| H | Sign-out revokes server-side |
| I | Patient reads own record, cannot read another patient's record or access log |
| J | Consent: duplicate request refused, self-approval refused, unrelated patient refused, past and over-long expiry refused, approve, grant visible, re-approval refused, revoke, double-revoke refused, grant inactive |

Re-runnability is a property, not a bonus: the first run left a pending access
request and the database's unique index correctly refused the second, so the
harness asserts that refusal and adopts the existing request. A harness that
only passes on a clean database stops being run.

### Browser — five of six roles, live API, real PostgreSQL

Every role signed in through the real credential path — employee identifier and
password, keystore, signer, challenge, JWT — with the seeded fixtures.

| Role | What was seen |
| --- | --- |
| **Doctor** | Dashboard with 19 real patients, real critical values and orders; the Lab Review queue; **a real mutation** (below) |
| **Nurse** | Nursing Dashboard, 15 assigned patients, "Tasks Due" now truthful after UI-006 |
| **Pharmacist** | Pharmacy Dashboard, 17 real allergy alerts, and the prescriptions the harness created through the Doctor sitting in the verification queue — the Doctor-to-Pharmacist path end to end |
| **Lab Technician** | Laboratory Dashboard, two pending specimens with patient names, a genuine unacknowledged critical potassium, the rejected specimen now identified |
| **Admin** | 121 users with a real role breakdown, and **the access log showing this pass's own audit events** — `prescription_signed`, `prescription_transmitted`, `lab_review_approve` with the correct actors. Independent confirmation of AUD-002 and APP-003 from a different screen and a different role. |
| **Patient** | Blocked: needs a browser wallet extension. See §E. |

### Doctor mutation — the full proof chain

| Check | Result |
| --- | --- |
| Sign-in through the real credential path | lands on `/dashboard` as "Dr Browser Test" |
| Dashboard data | API Connected, 19 patients, real critical values and orders |
| Pending Lab Reviews tile | **8** after UI-002 (was 0 with 8 waiting) |
| Lab Review screen | renders the queue; self-submitted rows show the reason and a disabled control |
| **Mutation**: approve from the browser | "approved and added to the patient record", row leaves the queue |
| Read-back: submission | `status = Approved`, `reviewed_by` = the doctor's wallet |
| Read-back: chart | contains `lab-LAB-26a73e6c` |
| Read-back: audit | `lab_review_approve` present via `/api/access-logs/{id}` after UI-003 |
| Reload | returns to sign-in — the documented session-restore limit, confirmed independently |

### Suites

| Suite | Result |
| --- | --- |
| API, nothing filtered | **508 passed, 0 failed, 1 ignored** (was 491) |
| Pallets | 60 (26 / 22 / 12) on the new lockfile |
| Doctor portal | **86 files / 331 tests** (was 85 / 321) |
| Patient app | 26 files / 83 tests |
| Typechecks | shared, doctor, patient — all pass |
| `cargo fmt --check`, `clippy --all-targets -D warnings` | clean |
| Repo gates | endpoint-auth, write-auth, state-durability, legacy-identity, **discarded-writes**, **audit-vocabulary** — all pass |
| `cargo deny check` root / blockchain advisories | ok / ok |
| WCAG AA contrast | 52 token pairs, both themes |

### New ratchets

`scripts/check-discarded-writes.py` — `let _ = data.repositories.x.create(...)`
type-checks, returns 200, and stores nothing when the write fails. 57 such
writes existed; two files were brought to zero and **55 remain across 24
files**, baselined so the number may only fall. Falsified: reintroducing one
discarded audit write fails it.

`scripts/check-audit-action-vocabulary.py` — described above. Falsified: an
unlisted value fails it.

## D. Things I got wrong

* **A concurrency test that proved nothing.** The first lab test asserted a
  second review could not overwrite the first and **passed against the unfixed
  code** — the pre-existing `status != Pending` check already rejects a
  sequential re-review, so it never reached the race. Renamed to claim only
  what it proves; the interleaving is proved against the repository primitive.
  The same trap caught the prescription transmission test.
* **A patch that silently never ran.** The `/lab-review` route registration was
  chained after an i18n script with `&&`; that script failed an assertion, so
  the route was never added. It looked applied because the typecheck after it
  passed. Only checking what vite was serving found it.
* **`Pagination::default()` is `per_page: 0`.** A test using it read zero rows
  with a non-zero total. No production caller uses it; recorded in the debt
  register rather than changed.
* **A page that reassured on failure.** My own Lab Review screen showed
  "Nothing is waiting for review" underneath a load error. A test written for
  it caught that.
* **I took the Laboratory Dashboard down.** The first attempt at UI-008 mapped
  each rejection to `entity.data`, which is reasonable for the JSON-document
  repository in the same file and wrong for this one: the field is
  `#[sqlx(skip)]` and always null for a PostgreSQL row. The panel received an
  array of nulls and the whole page died. The regression test now asserts the
  elements are objects, not merely that the names are right.
* **I trusted a rebuild that never happened.** A chained
  `build && restart` in one backgrounded shell reported success while leaving
  the old binary in place, so a fix looked ineffective for several minutes.
  Comparing the binary's mtime against the source's is what settled it.

## E. What is still open

**Blocked on this environment, not on the code**

* A successful patient sign-in in a browser needs a wallet extension this
  isolated browser does not have. The path is fixed and now fails for the right
  reason with the right message; the success path is undemonstrated.
* Browser *mutations* for Nurse, Pharmacist, Lab and Admin. All four were
  driven on screen and read correctly; only the Doctor performed a write
  through the UI, so the mutation half of the gate is met for one role.

**Owner decisions**

* The five hardcoded quick-login patients in the patient app target invented
  addresses, cannot work even with an extension, and are labelled "Click any
  patient to instantly login with their wallet". The clinician portal already
  answered this (`2e389f7`, `91b171f`) by removing patient accounts from its
  sign-in and rebuilding quick login on the real credential path behind a
  demo-gated resolver. Left in place under `CLAUDE.md` rule 7.
* 55 discarded repository writes remain. Each is a write whose failure the
  caller cannot see; the ratchet stops the number growing.
* `blockchain/Cargo.toml` declares MIT while `medichain-node` links 17 strict
  GPL-3.0-only crates, and the blockchain licence allow-list covers 1074 of
  1171 packages.

**Not started in this pass**

Telehealth provider qualification, national-ID sandbox, blockchain end-to-end,
observability chain, backup and restore, performance and SLOs, hosted CI
provenance and SBOM.

## F. Release decision

| Target | Verdict | Change from the previous pass |
| --- | --- | --- |
| **LOCAL DEMO** | **GO** | unchanged |
| **CLINIC DEMO** | **CONDITIONAL** | stronger: the lab and prescription workflows now behave correctly under concurrency and failure, and the lab queue is reachable |
| **CONTROLLED PILOT** | **NO-GO** | improved but not cleared: six roles now authenticate and cross-role, consent and IDOR lanes are proven at API level, but four personas are unproven on screen and the release artifact still has no source-to-image provenance |
| **PRODUCTION** | **NO-GO** | unchanged |

The honest summary: **the clinical state machines are now correct where they
were silently wrong, and the browser found three defects that no amount of API
testing would have.** The system is meaningfully better evidenced than it was,
and the personas that remain unproven are unproven because nobody has driven
them, not because anything says they work.
