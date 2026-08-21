# MediChain — Outstanding Work

**Written 2026-08-21.** Everything planned and not executed, in one place.

This is a handover document, not a status report. It is written to be picked up
cold — by you, by another engineer, or by a future session with no memory of
this one. Where something is *not done*, it says so plainly. Where I claimed
something was done and it later turned out narrower than the claim, that is
recorded too, because those are the entries most likely to mislead you.

**Read §0 first.** It is the short list of things that block showing this to
anyone.

---

## 0. Blockers — fix before anyone sees the application

Ordered by consequence, not by effort.

| # | Item | Why it blocks | Where |
|---|---|---|---|
| 1 | **No input-validation layer on the frontend** | A clinician can submit malformed clinical data and only learn on a 400. There is no shared validation abstraction across ~205 pages. | §2.1 |
| 2 | **GPL-3.0 licensing on `blockchain/node`** | 17 strict-GPL crates linked while the crate declares MIT. Becomes a real breach the moment a binary is distributed or handed to an infrastructure partner. | §4.1 |
| 3 | **Three undecided break-glass authorizations** | `POST /api/emergency-access` and `/api/emergency/nfc-token` currently admit Pharmacist and LabTechnician. Clinical-policy call, not an engineering one. | §3.2 |
| 4 | **Patient app has zero end-to-end coverage** | 53 pages, no browser test of any kind. Contrast, keyboard and reflow are verified only for the doctor portal. | §2.2 |
| 5 | **Security gates are report-only** | `cargo-deny` advisories and licences do not fail the build. "Green CI" currently means "the workflow finished". | §4.3 |
| 6 | **Timezone is a fixed UTC offset** | `CLINIC_UTC_OFFSET_MINUTES=120`. Silently wrong twice a year in any DST region. South Africa has no DST, which is luck, not design. | §3.4 |

---

## 1. What was actually completed (so you do not redo it)

Kept short. Detail is in `docs/TECHNICAL_DEBT_REGISTER.md` and the commit
messages on branch `development/medichain-federation-hardening`.

- **Semantic design tokens adopted** — ~9,000 raw Tailwind utilities migrated to
  the token system in `client/shared/src/styles/tokens.css` across 127 files.
  The token system already existed and was used in 11 files; the work was
  adoption, not creation.
- **Dark mode works and is measured** — 24/24 contrast tests across 12 routes ×
  2 themes (`client/doctor-portal/e2e/contrast.spec.ts`).
- **WCAG 2.2 AA criteria beyond text contrast** — 3.1.1, 1.4.10 (reflow at
  320px), 1.4.11, 2.1.1, 2.4.7, 2.4.11, 2.5.8, 1.3.1 all covered by
  `client/doctor-portal/e2e/accessibility.spec.ts`. 10/10 passing.
- **Analytics honesty** — fabricated KPIs replaced with counted values;
  `unmeasured` returned explicitly rather than estimated.
- **Audit outbox made durable** — `record_durable()` had zero callers; all 14
  sites rewired.
- **User deactivation made reversible** — admin directory reads the table, not
  the auth cache.
- **Telehealth recording authorization** — pharmacists can no longer start a
  recording; joins are audited.
- **Gates added** — `check-write-authorization.py`, `check-contrast.py`,
  `migrate-to-tokens.py --check`, plus blockchain-workspace `cargo-deny`.

**Current test state:** API 412 · doctor-portal 304 · patient-app 82 · pallets
60 · crypto 32 · e2e 209 assertions · Playwright 36. All passing. `npm run lint`
0 errors in both apps. `clippy --all-targets --all-features -D warnings` clean.

---

## 2. Frontend debt

### 2.1 Input validation — the largest single gap

**Status: not started. Nothing below is implemented.**

You named this and you are right. There is no validation layer. What exists is
ad-hoc `required` attributes and server-side rejection. Concretely missing:

- **No shared validation abstraction.** Every form re-implements its own checks,
  or does not. There is no schema, no resolver, no single place where "a blood
  pressure is two integers, systolic > diastolic" is written down.
- **No client-side constraint validation.** The HTML Constraint Validation API
  (`setCustomValidity`, `:invalid`, `validity.*`) is essentially unused, so the
  browser cannot help.
- **No error-to-field association.** Errors are rendered as banners. WCAG 3.3.1
  (Error Identification) and 1.3.1 require the error be *programmatically
  associated* with the field — `aria-describedby`, `aria-invalid`. A screen
  reader user currently hears an error with no idea which input caused it.
- **No `autocomplete` attributes.** WCAG 1.3.5 Identify Input Purpose (AA).
  Also the highest-value usability attribute in any form.
- **No input types/`inputmode`.** Numeric clinical fields present a full
  QWERTY keyboard on mobile.
- **Clinical range validation is absent.** Nothing stops a potassium of 640 or a
  date of birth in the future. In a clinical system this is a safety property,
  not a UX nicety.

**Recommended approach.** Do *not* hand-roll this per page.

1. Pick one schema library (Zod is the conventional choice with React Hook Form)
   and define schemas next to the API types in `client/shared/src/api/`.
2. Build **one** `<Field>` primitive in `client/shared/src/components/` that
   owns: label association, `aria-invalid`, `aria-describedby`, error text,
   `autocomplete`, `inputmode`, and the disabled/required states.
3. Migrate forms to it starting with the clinical-risk screens (§2.3 order).
4. Add the schema as the **single** source of truth — the same schema should
   validate on the client and be mirrored by server-side validation. Client
   validation is UX; server validation is the security boundary. Never let the
   client be the only check (see §3.1).

**Reference in your library:**
`knowledge-base/sources/external/frontend-forms-and-validation.md` — §1
labelling, §3 autofill, §4 constraint validation, §5 error messages, §6 the
governing WCAG criteria. It is primary-sourced and directly applicable.

### 2.2 Patient app has no end-to-end coverage

53 pages. Zero Playwright tests. Everything verified about contrast, keyboard
navigation, reflow and focus applies **only to the doctor portal**.

The patient app is arguably the higher-risk surface: it is used by non-experts,
on personal phones, in varied lighting, sometimes in an emergency (the medical
ID / emergency card screen).

**Work:** copy `e2e/contrast.spec.ts` and `e2e/accessibility.spec.ts` into
`client/patient-app/e2e/`, adjust routes and the login fixture, run, fix what
they find. Expect findings — the doctor portal had eight defect classes.

### 2.3 Screens never audited at all

The contrast suite covers 12 doctor-portal routes. The application has ~205
pages. Unaudited, in priority order by clinical consequence:

1. **Emergency card / medical ID (patient app)** — the one screen where
   illegibility could contribute to a death. Never audited.
2. Medication reconciliation, MAR, e-prescribe detail views
3. Lab result detail and trends
4. All surgical/procedure documentation pages
5. Messaging (see §2.4)
6. The remaining ~180 pages

### 2.4 Plan A sections never executed

From the frontend master plan, these sections had no work done:

| § | Topic | Note |
|---|---|---|
| 7 | **Typography as infrastructure** | No type scale audit. No check of body size, line height, or measure. Clinical text is dense and long. |
| 8 | **Fatigue scenario** | Never tested. The plan's own framing — "assume the user has worked an extremely long shift" — was never applied as an actual review pass. |
| 9 | **Messaging interface** | Never audited. Composer, placeholder contrast, unread indicators, send/disabled states. |
| 12–13 | **Responsive and vertical scaling** | Only 320px width on 4 routes. The plan lists 9 widths, 6 heights, and 6 zoom levels. Short-viewport clipping never tested. |
| 14 | **Dense information** | No work. Dashboards and clinical lists were never restructured for hierarchy. |
| 17 | **Tables** | Never audited: header contrast, alternating rows, selected/hover states, mobile strategy. |
| 18 | **Icons** | Never audited for meaning-without-text or minimum size. |
| 19 | **Full a11y stack** | `axe-core` is installed but **not wired into any test**. `pa11y`, `pa11y-ci` and `webhint` are not installed. Only `eslint-plugin-jsx-a11y` is active. |
| 20 | **Component-level quality gates** | No per-component tests across default/hover/focus/active/disabled/error/loading/dark states. |
| 21 | **Visual regression testing** | None. No screenshot baselines. |
| 26 | **Frontend code quality** | 419 ESLint warnings in doctor-portal, 91 in patient-app. Dead CSS, duplicated styling and magic numbers never addressed. |

### 2.5 Known frontend defects left in place

- **419 + 91 ESLint warnings.** Mostly `no-explicit-any`, unused vars, and
  `react-hooks/exhaustive-deps`. The `exhaustive-deps` ones are potential stale-
  closure bugs and should be triaged individually, not bulk-suppressed.
- **`jsx-a11y` rules set to `warn`** that should become `error` once the backlog
  clears: `click-events-have-key-events`, `no-static-element-interactions`,
  `label-has-associated-control`.
- **Gradient backgrounds are unmeasured.** The contrast auditor deliberately
  skips them (a gradient has no single background colour). Several headers use
  `from-emergency-500 to-emergency-600` with white text; that pairing is
  probably below AA and nothing checks it.
- **`text-white` was never migrated.** Deliberate — it is `content-inverse` on a
  dark surface but `brand-fg` on a filled button, and automating it risked
  invisible text. Needs a manual pass.
- **173 historical generated frontend tests still fail** (doctor 127, patient
  46). Diagnosed previously as test drift, not product defects — see the H3 note
  in `docs/PRODUCTION_READINESS.md`. Never actually repaired.

---

## 3. Architectural debt

This is the section you were right to separate from technical debt. These are
design decisions that will get more expensive the longer they stand.

### 3.1 The frontend is not treated as untrusted

**The principle** (from your own plan, and it is correct): the backend must be
the authoritative enforcement point for every security-sensitive rule; the
frontend may hold presentation and UX logic only.

**Where this stands:** mostly already true. The endpoint-auth gate reports 423
handlers — 246 at role authorization, 73 at resource scope, **0 at tier 0 or
1**. There is no meaningful population of endpoints trusting the client.

**So the framing "move business logic to the backend" is aimed at the wrong
target.** The real gap is narrower and sharper:

- **Role predicates are too coarse.** `is_healthcare_provider()` is true for
  Admin, Doctor, Nurse, LabTechnician *and Pharmacist*. It is the right question
  for "may this person see clinical data" and the wrong question for almost any
  specific action. This is exactly what let a pharmacist start recording a
  patient's consultation — logic that was *already server-side* and still wrong.
- **Fix: capability-named predicates**, not a policy engine. `may_control_recording(role)`,
  `may_read_patient_record(actor, patient)`. Mechanical, compile-checked,
  reversible. A DSL across 386 handlers is a hard-to-reverse bet you do not need
  yet — and your own coding standards judge architecture on the cost and risk of
  future change.
- `scripts/check-write-authorization.py` already surfaces every state-changing
  handler that relies only on the broad predicate. 13 reviewed, 3 escalated.

### 3.2 Three authorization decisions awaiting your judgement

Printed on every CI run until answered. These are clinical-policy calls.

| Endpoint | Question |
|---|---|
| `POST /api/emergency-access` | Break-glass bypasses consent to reveal the emergency capsule. Only treating roles (Doctor/Nurse/Admin), or any clinical staff? Paramedics map to `Nurse` in this system. |
| `POST /api/emergency/nfc-token` | Mints the one-time break-glass token. **Answer together with the above** or the two will drift apart. |
| `POST /api/nfc/generate` | Issues a patient identity credential to any clinical role. Identity issuance is usually a registration authority. |

### 3.3 No state-machine authority for clinical workflows

Status transitions are enforced ad hoc in handlers. There is no single place
that says which transitions are legal.

**Consequence:** the frontend can and does reason about status independently,
and the rules drift. `SCHEDULED → COMPLETED` should be impossible; nothing
structurally prevents a handler from allowing it.

**Work:** define explicit state machines server-side for appointments,
telehealth sessions, orders, lab submissions and consults. Return the *permitted
transitions* to the client so the UI can render from them rather than
re-deriving. The backend stays the only authority.

### 3.4 Timezone modelling is not production-grade

`CLINIC_UTC_OFFSET_MINUTES=120` is a number, not a rule set. A timezone is a
rule set.

**Correct model:** store `facility.time_zone = "Africa/Johannesburg"` (IANA),
store instants as UTC, convert at presentation boundaries only.

**Affects:** appointments, telehealth join windows, reminders, analytics
periods, audit timestamps. The analytics period selector was already fixed to
use calendar periods and local date parts; the underlying facility model was
not.

### 3.5 Analytics data contract is half-built

`null` vs `0` is now distinguished and `unmeasured` is explicit — that was the
important half. Not done: an explicit
`Metric<T> = Available(value, provenance) | Unavailable(reason) | Suppressed(reason)`
type, so "measured zero", "not collected", "query failed" and "not applicable"
can never collapse into one value again at the type level.

Also not done: a single `GET /analytics/overview?period=…` returning one
versioned DTO. The frontend currently assembles hospital KPIs from several
unrelated endpoints, which is how the contract drifted in the first place.

### 3.6 Cache-versus-domain conflation

`AppState.users` was an authorization cache being used as a user directory —
right for "who may act", wrong for "who exists". Fixed for users.

**Not audited:** whether the same conflation exists for other cached
collections. Worth one deliberate sweep. This codebase has produced the same
shape of bug four times (see §5).

### 3.7 Configuration is not validated as a matrix

`.env.example` permits combinations that should be impossible:
`APP_ENV=production` with `SUBSTRATE_ALLOW_DEV_SIGNER=true`, or production with
a missing signing key.

Two startup guards exist (`validate_no_privileged_dev_accounts`,
`validate_single_organisation`). Extend to a full matrix: development permits a
dev signer; staging and production forbid it and require a real key. Make it an
executable invariant, not documentation.

### 3.8 Bulk reads are deployment-wide by decision

39 handlers read via `list_all()` with no tenant scope. This is *intended* under
ADR-0007 (single organisation per instance) and enforced at startup by
`validate_single_organisation()`. Recorded here so nobody "fixes" it without
reading the ADR — but also so it is visible if you ever go multi-tenant, at
which point all 39 become real defects at once.

---

## 4. Supply chain, licensing and CI

### 4.1 GPL-3.0 in the node binary — release-blocking

`blockchain/node` declares `license = "MIT"` and links **17 crates under plain
`GPL-3.0-only`** — no Classpath exception, no permissive alternative
(`polkadot-*`, `staging-xcm*`, `tracing-gum*`).

Measured from the resolved lockfile:
- `medichain-runtime`: **0** strict-GPL crates. Clean.
- `medichain-node`: 17, **all arriving through one dependency —
  `frame-benchmarking-cli`**, which also drags in the entire Cumulus / parachain
  / XCM stack that a solo chain never uses (and is why a release build needs
  ~20 GB).

Not a live breach: the binary is not distributed today, and the release workflow
explicitly says it does not publish. It becomes one the moment it is promoted.

**Two options, both written up in `docs/TECHNICAL_DEBT_REGISTER.md`:**
1. Make `frame-benchmarking-cli` optional behind the existing
   `runtime-benchmarks` feature. Removes all 17 crates from default builds and
   massively shrinks the build. **Cost:** drops `benchmark block/overhead/
   extrinsic/machine` from a default binary — a removal of working
   functionality, which is why I did not do it unilaterally.
2. Relabel the node crate `GPL-3.0-only` and accept the obligations.

This needs your decision, and probably a lawyer's if the infrastructure partner
takes delivery of a binary.

### 4.2 Stale security exception

The root `deny.toml` ignores `RUSTSEC-2022-0061` on the grounds that the node
"is a stub — no pallet WASM is actually compiled or executed." That stopped
being true on 2026-08-11. The ignore may still be defensible; **the stated
reason is not**.

Every ignored advisory should carry: ID, affected dependency, reachability
analysis, mitigation, owner, and an expiry date. CI should fail when an
exception expires.

### 4.3 Security gates do not block

`ci.yml` has **8** `continue-on-error: true` steps. Report-only today:
- `cargo-deny` advisories (root and blockchain)
- `cargo-deny` licences (blockchain)
- `cargo audit`
- root clippy
- Lighthouse
- Snyk (also gated on `vars.SNYK_ENABLED`, so it is not part of the security
  baseline unless someone remembers to set it)

**"Green" currently means "the workflow completed", not "the merge policy
passed."** Split checks into blocking / non-blocking-but-tracked /
informational, and make the distinction visible. Do not simply flip the flags —
first resolve or formally risk-accept each finding, or every future PR fails on
pre-existing issues.

Blockchain-workspace `cargo-deny` licence allow-list was derived offline from
1074 of 1171 locked packages (97 were not in the local registry cache). Confirm
completeness from a full CI run before making it blocking.

---

## 5. The defect pattern that keeps recurring

Worth internalising, because it has now produced **four** separate bugs in this
codebase:

> **A correct implementation exists, unused, beside the wrong one that
> everything calls.**

| Instance | Correct thing | What was actually used |
|---|---|---|
| Audit durability | `AuditOutbox::record_durable()` — zero callers | `record()`, in-memory, lost on restart |
| Dark mode | Full `.dark` palette in `tokens.css` | Raw palette classes on 148 of 152 pages |
| Design tokens | 76 semantic tokens, contrast-checked | `text-gray-700` × 924 |
| Control borders | `--border-interactive`, documented against WCAG 1.4.11 | `--border-default` at 1.24:1 |

**Diagnostic:** when something looks missing, grep for whether the correct
version already exists and simply has no callers, *before* building it.

```bash
grep -rn "record_durable" api/src --include=*.rs | wc -l   # 0 = the finding
```

A second, related pattern: **a successful write that no reader can see.** The
in-memory repository enforces no CHECK/FK constraints, so schema-vs-code drift
appears only on PostgreSQL. Assert durability through the real endpoint, not the
repository.

---

## 6. Testing debt

- **E2E suite is re-runnable but not isolated.** Three consecutive runs pass;
  roughly twenty do not, because appointments accumulate and the booker
  correctly refuses overlaps. Proper fix: per-run namespacing (`test_run_id` on
  every fixture, cleanup by that id) or a fresh database per CI job.
- **Skips are not bounded.** Six credential assertions skip on the in-memory
  backend. There is no CI rule failing on *unexpected* skips or on the skip
  count increasing, so a feature could silently disappear from the signal.
- **Test count is weak evidence.** 412 API tests do not tell you that patient A
  cannot read patient B's record. Write the explicit deny matrix: actor ×
  resource × action, asserting both ALLOW and DENY. 78 denial assertions exist;
  cross-facility denial is absent by ADR-0007.
- **Latency check is a smoke test.** Worst-of-5 against a 400 ms budget, on a
  local stack. Honest, but it is not a p95 and should not be quoted as one.
- **No visual regression baselines.** Nothing catches a layout regression that
  is not also a contrast failure.

---

## 7. Genuinely blocked on external dependencies

Not debt. Recorded so nobody spends time on them.

- **NFC card scanning** — needs physical hardware.
- **Live SMS delivery** — needs Africa's Talking credentials only you can create.
  The request shape is already covered by a `wiremock` test.
- **Multi-validator Substrate testnet** — needs real infrastructure. Chaos
  testing, runtime-upgrade rehearsal, session-key procedure, validator
  hardening, monitoring and backup/restore drills all sit behind it
  (`IMPLEMENTATION_PLAN.md` §1.1–1.3).
- **Annual penetration test** — scheduling and scope.
- **POPIA regulatory filings** — Information Regulator registration, PAIA
  manual, processing-activity register, transborder assessment, legal sign-off
  (`docs/GOVERNANCE_RECORD.md`).
- **Burn TBSA Lund-Browder** — deferred to you as a clinical scope decision.

---

## 8. Environment notes for the next session

- **Disk fills fast.** Freed 24.5 GB by `cargo clean` on both workspaces (host
  went 0.7 GB → 22.1 GB). Docker's WSL2 virtual disk still holds ~17 GB of
  already-freed space; reclaiming it needs Docker stopped and the VHDX
  compacted.
- **`:8090` is not the Docker API.** `medichain_api` publishes no ports. The
  only front door is nginx on `:80`. A stray local debug binary on `:8090` cost
  a full rebuild cycle chasing a route bug that did not exist.
- **Run `npm run lint`, not `npx eslint`.** The project script passes
  `--report-unused-disable-directives`; a hand-rolled invocation does not, and
  that difference failed CI.
- **Playwright** needs `VITE_API_PROXY_TARGET=http://127.0.0.1` to reach the
  Docker stack, because the dev server defaults to `:8090`.
- **Toolchain:** GNU/mingw64 only. Export `PATH` and
  `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu` before any cargo command.
- **API tests** use `--bin medichain-api`, never `--lib`.

---

## 9. Suggested order of work

If you resume with limited budget, this is the sequence I would use.

**First — cannot be shown without these**
1. Input validation layer (§2.1). Largest gap, highest user-visible impact.
2. GPL decision (§4.1). One decision, then a small change either way.
3. The three break-glass authorizations (§3.2). Decisions, not code.

**Second — correctness you will otherwise rediscover painfully**
4. Patient-app e2e coverage (§2.2). Copy the two existing specs; expect findings.
5. Emergency card / medical ID audit (§2.3 item 1).
6. Capability-named predicates for the top ~20 sensitive actions (§3.1).

**Third — stops the bleeding**
7. E2E isolation via per-run namespacing (§6).
8. Make security gates blocking, after triaging each finding (§4.3).
9. Timezone → IANA (§3.4).

**Later — real, but not urgent**
10. Remaining Plan A sections (§2.4), starting with forms, tables and typography.
11. State machines (§3.3).
12. The 419 + 91 lint warnings (§2.5).
13. Visual regression baselines (§6).

---

## 10. Where the detail lives

| Document | Contains |
|---|---|
| `docs/TECHNICAL_DEBT_REGISTER.md` | Per-defect writeups with measurements and reasoning |
| `docs/FEATURE_END_TO_END_AUDIT.md` | Authoritative feature ledger (supersedes older inventories) |
| `docs/PRODUCTION_READINESS.md` | Issue status and evidence requirements |
| `docs/NEXT_WEEK_TODO.md` | Short-horizon items including the escalated authorizations |
| `IMPLEMENTATION_PLAN.md` | 41 tracked items across 13 phases; §1.1–1.3 is the validator plan |
| `docs/adr/0007-single-organisation-per-instance.md` | Why bulk reads are unscoped |
| `knowledge-base/sources/external/frontend-*.md` (in your books library) | 12 primary-sourced frontend notes — forms, colour, layout, typography, Core Web Vitals. The library holds no front-end books; these notes are the substitute and they are good. |

---

## 11. A note on how to read claims in this repository

Several times in this work, something reported as complete turned out to be
narrower than the claim:

- "Zero placeholders" was true of the keyword detector and false of the product
  — a bare `94%` in JSX matches no keyword.
- "The frontend is clean by measurement" meant one WCAG criterion out of eight.
- "Audit logging exists" was true, while the events lived only in process memory.
- A latency assertion passed while measuring nothing, because a subshell
  discarded the value.

The common thread is that **a gate that cannot fail looks identical to a gate
that passes**. When you inherit a green check here, the useful question is not
"did it pass" but "what would have made it fail, and has that ever happened".
