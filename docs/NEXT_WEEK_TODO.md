# MediChain — Next Week TODO

**Created:** 2026-06-04
**Owner:** Keorapetswe Kgoatlha (mrlucas679)

This is the active backlog for the upcoming week. It supersedes the historical
hackathon trackers. Source of per-feature detail: [`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Stage 1 — Finish remaining IMPLEMENTATION_PLAN items (in-scope)

### Persistence & data fidelity (2.1)
- [x] Replace `#[sqlx(skip)]` "extras" data-loss on PostgreSQL round-trips
      (appointments, medication_reminders, immunization) with a JSONB column or typed columns
- [x] Verify all 70+ tables have matching repository CRUD; close any gaps
- [x] Confirm `MEDICHAIN_STORAGE=postgres` activates PostgreSQL for **every** endpoint

### Frontend completeness (3.1, 3.2, 4.1-UI, 13.2)
- [x] `DeathCertificatePage` — add certifier state + working "Sign & Submit" handler
- [x] `PediatricsPage` — full vertical (backend route + shared API fn + page wiring)
- [x] Finish thin patient-app pages (Vital Signs, Medications integration polish)
- [x] Surface drug-interaction warnings in the prescription UI
- [x] Gate all demo-data fallbacks behind `IS_DEMO` (Insurance/LabTrends/Wearables/MAR)

### Notifications & security (5.2, 5.3, 6.1, 6.3, 11.4)
- [x] FCM push: HTTP v1 client + `device_tokens` table + registration endpoint
- [x] Persistent per-patient SMS opt-out table
- [x] Secrets-rotation documentation + key-management guidance
- [x] Encryption-required policy at the API middleware layer + key-rotation support
- [x] SMTP dispatch for regulator/data-subject breach notifications **(needs SMTP provider — scaffold + document)**

### Infra & observability (8.1, 8.2, 12.1)
- [x] Add Substrate node service + `docker-compose.prod.yml` overrides + per-service health checks
- [x] Wire Grafana dashboard + Prometheus alert rules into the deployment
- [ ] Frontend bundle analysis + code-split doctor vs patient apps (< 200KB initial JS)

### i18n + CDS (3.5, 4.3)
- [ ] Extract user-facing strings to translation files across all remaining pages
      (Login page is the reference implementation)
- [ ] Per-facility configurable CDS thresholds + CDS audit trail (which rule fired, action taken)

### API & data pipeline (9.3, 9.5, 4.1-data)
- [x] Adopt cursor pagination on the remaining list endpoints (+ "load more" UI)
- [~] Migrate the ~1140 ad-hoc error responses to the canonical `error_envelope_json`
- [ ] Import RxNorm/DrugBank open datasets to expand drug-interaction coverage **(data pipeline)**

### Mobile (8.3)
- [ ] NFC card scanning (`react-native-nfc-manager`) **(needs device hardware)**
- [ ] QR scanning (`expo-barcode-scanner`); offline-first sync wiring
- [ ] `npm install && npm run typecheck` verification; reach patient-app parity

---

## Stage 2 — Multi-agent codebase cleanup (after Stage 1)

Run as specialist agents in separate lanes (worktrees) with a verifier gate between merges.

- [ ] **Refactor agent** — further-split large submodules toward ~300 lines
      (`engagement`, `workflow`, `surgical`, `platform`, `emergency`); extract `validators.rs`;
      keep handlers ≤ 40 lines; slim `main.rs` toward bootstrapping-only (10.1, 10.2)
- [ ] **Dead-code / debug agent** — drive the ~175 compiler warnings to zero;
      remove `#[allow(dead_code)]`; delete the 2 dead autopsy handlers; fix latent bugs (8.4)
- [ ] **Test agent** — load/stress tests for concurrent clinical endpoints (7.2);
      `cargo-fuzz` targets for input validators (12.2); raise frontend coverage
- [ ] **Frontend-quality agent** — replace remaining `as any`/`@ts-ignore`; accessibility pass;
      ensure `endpoints.ts` returns typed results (not `unknown`)
- [ ] **Verifier agent** — full `cargo check`/`clippy -D warnings`/`cargo test` +
      `npm run typecheck`/tests after each lane; gatekeep the green baseline

---

## Process / external dependencies (track, not blocking)
- [ ] Annual penetration-testing framework (HIPAA 2025) — schedule + scope (11.3)
- [ ] Snyk scanning in CI **(needs token)** (11.2)
- [ ] Pin exact dependency versions in `Cargo.toml` (11.2)
- [ ] Live Africa's Talking SMS verification **(needs sandbox creds)** (5.3)

---

## Notes
- Commits are authored solely by the repository owner; no AI-assistant attribution.
- Keep the working tree green (`cargo check --workspace`, `npm run typecheck`) before each commit.
