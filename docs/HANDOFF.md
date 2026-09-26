# MediChain build handoff (2026-09-26)

Status of the "MediChain remaining features" build prompt (WP1–WP16): what is
done, what is in progress, and the plan for everything left. Pick up from
**"Resume here"**.

## How the work is organised

- One work package per branch and PR. The PRs are **stacked**: each is based
  on the previous feature branch, so they merge in order (#19 first). When one
  merges, retarget the next onto `development/medichain-integration`.
- GitHub Actions has not run any job since 2026-09-25 (jobs end in seconds with
  `runner_id: 0`: an account billing/spending-limit block). **No PR has had CI
  yet.** Everything below was verified locally only.
- Local verification used for every PR: `cargo fmt --check`, `cargo clippy
  --all-targets` (zero warnings), `cargo test -p medichain-api` against
  PostgreSQL 16, every `scripts/check-*.py`, both client builds, and both
  `npm run test:gate`.

## Done (PR open, verified locally)

| WP | PR | Branch | Summary |
| --- | --- | --- | --- |
| 1–6 | on `development/medichain-integration` | — | Earlier packages (committed before this session's PRs) |
| 7.1 | [#19](https://github.com/Lukau-Tech-Invasion/medichain/pull/19) | `feature/7-1-refill-requests` | Prescription refill requests |
| 7.2 | [#20](https://github.com/Lukau-Tech-Invasion/medichain/pull/20) | `feature/7-2-message-attachments` | Message attachments (scan hook, encrypted) |
| 7.3 | [#21](https://github.com/Lukau-Tech-Invasion/medichain/pull/21) | `feature/7-3-eob-documents` | Explanation-of-benefits documents |
| 7.4 | [#22](https://github.com/Lukau-Tech-Invasion/medichain/pull/22) | `feature/7-4-research-export` | Consented, de-identified research export (two-admin approval) |
| 7.5 | [#23](https://github.com/Lukau-Tech-Invasion/medichain/pull/23) | `feature/7-5-blood-inventory` | Blood-unit inventory |
| 7.6 | [#24](https://github.com/Lukau-Tech-Invasion/medichain/pull/24) | `feature/7-6-telehealth-recording` | Consented telehealth recording + Jibri (opt-in compose profile) |
| 8 | [#25](https://github.com/Lukau-Tech-Invasion/medichain/pull/25) | `feature/8-merkle-anchoring` | Merkle-batched audit anchoring, verify endpoint, `add_alert` removed with storage migration |
| 9 | [#26](https://github.com/Lukau-Tech-Invasion/medichain/pull/26) | `feature/9-care-relationships` | Care relationships + break-glass gate on chart reads |
| 10 | [#27](https://github.com/Lukau-Tech-Invasion/medichain/pull/27) | `feature/10-access-reason-everywhere` | Access reason on every chart; server-issued access contexts |
| 11 | [#28](https://github.com/Lukau-Tech-Invasion/medichain/pull/28) | `feature/11-operations` | Advisory-locked jobs, records-summary endpoint, pgBackRest backups (rehearsed) |

Decisions taken on the owner's instruction ("choose the best option"):
Jibri for recording, remove (not hash) `add_alert`, pgBackRest for backups.
Reasons are in PRs #24, #25, #28 and `docs/BACKUP_RESTORE_RUNBOOK.md`.

## In progress: WP12 security hardening

Branch `feature/12-security-hardening` (draft PR). **Part 1 is written but
its full verification has not run.**

### 12.1 Sessions survive a reload: code written

- `api/src/refresh_cookie.rs`: the refresh token as an `HttpOnly; Secure;
  SameSite=Strict; Path=/api/auth` cookie, set by hand (actix-web is built
  without its `cookies` feature).
- `handlers/auth_jwt.rs`:
  - `/api/auth/jwt` and `/api/auth/jwt/refresh` set the cookie;
  - the refresh token is in the JSON body only with `X-Refresh-Transport: body` (non-browser clients);
  - refresh reads the body or the cookie;
  - a refused refresh clears the cookie, and so does logout.
- `auth_sessions::rotate`: **reuse detection**. A generation replayed more
  than `REUSE_GRACE_SECONDS` (10 s) after its rotation revokes the whole login.
- Production CORS `supports_credentials()` (explicit origins only).
- Client: `ApiClient` keeps only the access token in memory, refreshes via
  the cookie (`credentials: 'include'` on `/api/auth/*`), and has
  `restoreSession()`. The doctor portal's restore re-enters the work context.
  The patient app's restore is now async and fails closed (it used to mark the
  patient signed in with no token).
- Tests added (passing):
  - `refresh_cookie` unit tests;
  - `test_pg_refresh_token_reuse_revokes_the_login`;
  - `refresh_cookie_tests` (cookie restores and rotates; an old or missing cookie is refused and cleared).

**Still to do for 12.1:**
1. Run the full verification:
   - `cargo test`;
   - both `test:gate` (the store changes may need test updates, e.g. patient `restoreSession` is now async; `patient-app/src/main.tsx` calls it without awaiting, which is fine);
   - both builds;
   - clippy and fmt.
2. Update `mobile-examples/` (if any read `refresh_token` from the body) to send `X-Refresh-Transport: body`.
3. Doctor `DashboardPage.tsx` comment near line 219 refers to restore failing closed "by design". Update the wording.

### 12.2 Signature step-up: plan

ADR-0008 step-up already exists (`handlers/transaction_auth.rs`,
`/api/auth/step-up/*`, `require_step_up`-style checks: grep `step_up`). Switch
it on only for:
- role changes;
- break-glass (`handlers/break_glass.rs`);
- research export approve/execute (`handlers/research_exports.rs`) and any bulk export;
- retention execution (`handlers/retention_admin.rs`, execute endpoints);
- key rotation (`organization_keys`, encryption keyring rotation).

Each needs:
- the server check (403 `STEP_UP_REQUIRED`);
- the client `useStepUp`/`StepUpDialog` wiring, which exists in shared;
- a test per route for the success, the 403 without step-up, and storage failure.

Break-glass must stay possible in an emergency: if step-up can't be
completed, fall back to the existing audited break-glass and log it. Get
clinical sign-off on that choice.

### 12.3 Patient keys: plan

1. Stop showing the recovery phrase on the clinician's screen during
   registration (doctor `RegisterPatientPage.tsx`; find where the mnemonic is
   rendered).
2. The patient app generates keys on the device (WebCrypto or
   `client/wasm-crypto`) at first sign-in or claim. The server only ever
   receives the public key/wallet.
3. Custodial option for patients without smartphones:
   - a server-held key in a key store (reuse `encryption_keyring` patterns; the key encrypted at rest);
   - an admin/clinician flow that prints a sealed recovery card: a PDF (`api/src/pdf.rs` exists) with a one-time recovery code;
   - audited;
   - migration for a `custodial_keys` table.

### 12.4 Strict values: plan

Enums in Rust plus CHECK constraints in Postgres, starting with H&P status and
consult specialty.
- One shared list module: Rust `api/src/value_lists.rs`, exposed via `GET /api/value-lists`, and the UI dropdowns read it.
- Include a migration that normalises existing free-text values before adding the CHECK.

### 12.5 Break-glass while the audit store is down: plan

`api/src/deferred_emergency_audit.rs` already implements a durable deferred
mode (`EmergencyAuditMode::DurableDefer`, replayed by a job in `main.rs`).
Check it against `docs/CLINICAL_GOVERNANCE_DECISIONS.md` §3:
- a local **encrypted** append-only journal;
- `MAX_DEFERRED_AUDIT_AGE_HOURS = 24`;
- an **immediate alert to the security officer**;
- reconciliation into `access_logs`;
- behind a policy flag that defaults to the current refuse behaviour.

Fill whatever is missing, with tests.

### 12.6 Offline emergency card: plan

Let the patient choose which fields go on the offline card (patient
`EmergencyCardPage.tsx` and the offline cache in shared `useOfflineCache`).
Store only the chosen minimum, and explain it plainly in the app. Store the
selection per patient (a preferences field), and have the offline cache write
only those fields.

## Not started: plans

### WP13 Policy as configuration

`config/policy/*.json` (or TOML): validated and versioned, each file with
`approved_by`, `approved_on` and `source`. A loader validates at startup;
unapproved values show "default — not clinically approved" in the UI.
- **Vital-sign thresholds:** global defaults plus per-facility overrides; extend the lab-result override mechanism.
- **Controlled substances:** Medicines and Related Substances Act S5/S6 mapped to the existing second-pharmacist check (`dispensing_policy.rs`). Until a pharmacist approves, the check applies to nothing and says so.
- **Retention periods:** the 10 existing periods with legal citations (`data_retention_policies` seed). Deletion stays disabled until a reviewer and date are recorded.
- **Drug interactions:** a pluggable loader. The ~170 current pairs are the bundled dataset, labelled "supplementary — not a substitute for pharmacist review". An importer for a licensed dataset is selected by configuration; embed no licensed data.
- **Telehealth recording retention:** currently `RECORDING_RETENTION_ENTITY = "clinical_record"` in `repositories/telehealth_recordings.rs`.
- **Policy defaults already in code** (move them into policy files):
  - `blood_inventory.rs` thresholds;
  - `care_access.rs` windows (30 days encounter, 90 days referral, 60 minutes break-glass);
  - `handlers/access_context.rs` (8-hour contexts).

### WP14 Insurance and languages

- **Insurance:** link patient-entered medical-aid cards to payer-policy records, matching on scheme and member number, then confirmed by an admin. Eligibility then answers from the linked policy; unlinked cards stay patient-entered.
- **Languages:** add locales for isiXhosa, Sesotho, Setswana and Afrikaans (zu-ZA exists), with a language switcher.
  - No machine translation. Untranslated keys fall back to English and are listed by a script for human translators.
  - Build only a provider interface for future machine translation of clinical text (provider none by default), labelled "machine translation — confirm with the patient".

### WP15 One storage layer for safety-critical data

Migrate these from JSON stores to typed repositories with database
constraints:
- medications and prescriptions;
- allergies;
- vitals and triage;
- consent and access grants;
- emergency capsule;
- access logs.

**Ask the owner before deleting** the unused typed repositories for other entities.

### WP16 Facility registry

- `facilities(id, name, type, province, district)`, seeded (see WP5 demo facilities, `handlers/demo.rs` seed-facilities).
- Professional assignments reference a facility.
- `AccessLogView` and the patient's history show the facility **name**.
- An admin UI to manage facilities.

## Open items for the owner

- **Blocking:** fix GitHub Actions billing so CI runs, then merge PRs in order from #19.
- **Clinical sign-off needed:**
  - thresholds (blood stock, care-relationship windows, break-glass duration);
  - research consent wording;
  - controlled-substance schedule (pharmacist).
- **Fabricated value:** `rendering_provider_npi: "1234567890"` in `create_insurance_claim`. Needs a real source or removal.
- **Missing role:** there is no Billing role; EOB upload is Admin-only for now.
- **Admin chart access (WP9):** administrators keep chart access, recorded as authority `admin`. Decide whether they should need break-glass instead.
- **Backups:** store `PGBACKREST_REPO1_CIPHER_PASS` and `PGBACKREST_REPO2_CIPHER_PASS` in a secret store; create the Azure storage account for off-site copies.
- **Windows:** run `git config --global credential.helper manager`.

## Resume here

1. `git checkout feature/12-security-hardening`
2. Finish 12.1 verification (see "Still to do for 12.1"), then 12.2 → 12.6.
3. Commit, update the WP12 PR, then continue WP13 → WP16, one PR each,
   stacked on the previous branch.
