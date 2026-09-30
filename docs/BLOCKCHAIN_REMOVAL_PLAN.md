# Blockchain removal — work plan and shared contract

Decision: [ADR-0010](adr/0010-remove-blockchain-and-wallet-identity.md).
Branch: `feature/remove-blockchain` (based on the WP12 WIP commit `4b92d24`).
This file is the contract every agent works from. Where it and the code
disagree, the code is the fact and this file is updated; where it and an agent's
preference disagree, this file wins — raise it, don't re-decide it.

## Phases

| Phase | What | Depends on |
| --- | --- | --- |
| **A** | Remove the chain: node, pallets, `subxt`, anchoring, chain fields. Replace anchoring with the sealed audit stream. | — |
| **B** | One user key: `users.id` becomes the JWT `sub` and the value of every actor column. | A |
| **C** | Sign-in without wallets: staff password, patient activation code + password, optional TOTP, TOTP/password step-up. Remove sr25519, Polkadot, recovery phrases, SS58. Rewrite the test harnesses' sign-in. | B |
| **D** | Full verification on PostgreSQL and the rebuilt Docker stack; final trace sweep. | C |

Microservice decomposition is a later, separate decision. Nothing here is
structured around it.

## Rules for every agent

- Follow `CLAUDE.md` (≤60 branching/binding lines per function, bound SQL
  parameters only, request types rather than domain types in handlers, no
  plausible defaults, server-side clinical scoring, patient-visible reads).
- Deleting **blockchain/wallet code, config and docs is approved** for this
  campaign. Deleting anything else: stop and report it instead.
- Never rewrite data that is hashed, sealed or committed (access-log rows,
  Merkle members, capsule commitments). Map, don't migrate.
- Migrations are forward-only: new files, never edits to applied ones.
- Do **not** commit, push, touch `.env`, stop or rebuild Docker containers, or
  run the browser suites / role journeys (they share one rate limit).
- Only one agent runs `cargo` at a time. Cargo needs the GNU toolchain:

  ```bash
  export PATH="/c/Users/Admin/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
  export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu
  ```

  PostgreSQL tests: `DATABASE_URL=postgres://medichain:medichain_dev_2024@localhost:5432/medichain`
  (each run creates its own schema; the demo data in `public` is not touched).

## Phase A contract

### Sealed audit stream (replaces anchoring)

- **Sources:** every `access_logs` row, and every `audit_events` row (the
  renamed `audit_outbox_events`: privacy-minimised event type, aggregate id,
  payload hash, payload JSON without PHI).
- **New audit events** replacing the four `anchor_*_or_queue` calls:
  `emergency_capsule_published` (capsule id, version, commitment hex),
  `medical_record_stored` (record id, content digest),
  `patient_registered` (patient id, registration digest). Individual
  access anchoring disappears — the access-log row is already sealed.
- **Batching** (existing single-instance job, advisory lock): up to 1024
  unsealed leaves from both sources per batch. Access-log leaves keep the WP8
  encoding unchanged (`medichain.audit.leaf.v1`); audit-event leaves use their
  own domain (`medichain.audit.event.v1`).
- **Chaining and signing** in the same transaction that creates the batch:
  `batch_hash = SHA3-256("medichain.audit.batch.v1\0" ‖ id ‖ first_seq ‖
  last_seq ‖ leaf_count ‖ merkle_root ‖ prev_batch_hash)` with fixed-width,
  length-prefixed fields; `prev_batch_hash` is the previous batch's
  `batch_hash` (absent for the first). Sign `batch_hash` with Ed25519 (add
  `ed25519-dalek` to `medichain-crypto`). Legacy `pending` batches are sealed in
  id order before new ones are built.
- **Export**: sealed batches, in id order, are written as
  `<dir>/<batch_id>.json` (all header fields + signature + key id), atomically
  (temp file + rename). An existing file with different content is an error,
  never an overwrite. Status goes `sealed` → `exported`.
- **Never on the request path.** Handlers only write their rows inside their
  existing transaction and keep failing closed when *that* write fails
  (`AUDIT_PERSISTENCE_REQUIRED`). Remove `PATIENT_WALLET_REQUIRED`,
  `CHAIN_AUDIT_UNAVAILABLE`, `CHAIN_ANCHOR_UNAVAILABLE` and every
  `blockchain_enabled()` branch.

### Configuration

| Remove | Add |
| --- | --- |
| `BLOCKCHAIN_ENABLED`, `SUBSTRATE_WS_URL`, `SUBSTRATE_SIGNING_KEY`, `SUBSTRATE_ALLOW_DEV_SIGNER`, `MEDICHAIN_CHAIN_NETWORK`, any other chain variable | `AUDIT_SEAL_SIGNING_KEY` — 64 hex chars (Ed25519 seed). Required outside demo; in demo, unset means batches are sealed **unsigned** and verification says so. |
| | `AUDIT_CHECKPOINT_SINK` — `none` \| `filesystem`. Production refuses `none`. |
| | `AUDIT_CHECKPOINT_DIR` — absolute path, required with `filesystem`. |

### Schema (one new migration, `api/migrations/20260929000001_remove_blockchain.sql`)

- `audit_anchor_batches` → `audit_seal_batches`: drop `tx_hash`, `block_hash`,
  `block_number`, `finalized_at` and the finalized-has-block constraint; status
  `pending | sealed | exported`; add `prev_batch_hash`, `batch_hash`,
  `signature`, `signing_key_id`, `sealed_at`, `exported_at`, `export_ref`, with
  CHECKs that a sealed/exported batch has its hash and timestamps.
- `audit_anchor_batch_members` → `audit_seal_batch_members`: add
  `source` (`access_log | audit_event`), rename `access_log_id` → `source_id`,
  unique on `(source, source_id)`.
- `access_logs`: `anchor_seq` → `seal_seq`; drop `blockchain_tx_hash`.
- `audit_outbox_events` → `audit_events`: add `seal_seq BIGSERIAL UNIQUE`; drop
  the delivery columns; delete the 59 `audit_batch_chain_anchor` rows (chain
  delivery jobs, not audit facts).
- Drop: `emergency_capsules.chain_tx_hash`, `.chain_finalized`;
  `emergency_access_grants.blockchain_tx_hash`; `medical_records.blockchain_tx_hash`;
  `patients.blockchain_tx_hash`; `users.blockchain_address`, `.blockchain_tx_hash`.
  `medical_records.on_chain_hash`: rename to `content_digest` if it is the
  content digest something reads, otherwise drop — report which.
- Recreate any view that selected a dropped or renamed column.
- **Keep** `chain_of_custody` and `specimen_collections.chain_of_custody` (clinical).
- `users.wallet_address` stays until Phase B.

### API response contract (the frontend works from this)

| Where | Remove | Add |
| --- | --- | --- |
| `GET /api/patients/{id}/verify` rows | `anchor_status`, `block_number`, `tx_hash` | `seal_status: 'pending' \| 'sealed' \| 'exported' \| null` (null = unbatched), `batch_hash: string \| null`, `signature: 'valid' \| 'invalid' \| 'unsigned' \| null`, `sealed_at`, `exported_at` (ISO or null) |
| same, top level | — | `seal_key: { key_id, algorithm: 'ed25519', public_key } \| null` |
| same, capsule | `'unanchored'` | `'unsealed'` → `'match' \| 'mismatch' \| 'unsealed' \| 'none'` |
| Capsule versions | `chain_tx_hash`, `chain_finalized` | `seal_status: 'pending' \| 'sealed' \| 'exported'` |
| Capsule publish (`POST …/emergency-capsule`) | `anchoring`, `blockchain_tx_hash` | `seal_status` |
| Emergency / lockscreen views | `chain_audit_status`, `blockchain_tx_hash` | — |
| Medical-record upload and list items | `blockchain_tx_hash`, `on_chain_hash`, `anchoring` | `seal_status` |
| Access-log list items (patient history, doctor access logs) | `blockchain_tx_hash`, `anchor_status`, `block_number`, `tx_hash` | `seal_status` (`pending` = not yet batched) |
| Emergency grants, break-glass, registration | `blockchain_tx_hash`, chain fields | — |
| `GET /api/health`, dashboards, analytics, compliance | `blockchain*`, `chain_*` | `audit_seal: { unsealed_events, last_sealed_at, last_exported_at, sink: 'none' \| 'filesystem', signing: 'ed25519' \| 'unsigned' }` |

UI wording: no "blockchain", "on-chain", "anchored", "finalized block",
"transaction hash". An integrity badge, where one exists, reads from
`seal_status` (e.g. "Sealed", "Sealed and exported", "Sealing pending").

### Ownership (Phase A agents edit only their own paths)

| Agent | Owns |
| --- | --- |
| **A1 backend** | `api/**`, `crypto/**`, root `Cargo.toml`/`Cargo.lock`, `deny.toml`, `scripts/check-*.py` (existing gates), new `scripts/verify-audit-checkpoints.py` |
| **A2 infra & docs** | `blockchain/` (delete), `.github/**`, `docker-compose*.yml`, `docker/**`, `nginx/**`, `Caddyfile`, `.env.example`, `scripts/**` except the gates above, `docs/**` except this file, `CLAUDE.md`, `README.md`, `AGENTS.md`, `COPILOT.MD`, `CHANGELOG.md`, new `scripts/check-no-blockchain.py` |
| **A3 frontend** | `client/**`, `mobile-examples/**`, `e2e/**` — chain parts only; wallet sign-in is Phase C |

### Phase A acceptance

- `cargo fmt --check`; `cargo clippy --all-targets --all-features -- -D warnings`;
  `cargo test --bin medichain-api` on PostgreSQL; `cargo test -p medichain-crypto`.
- Tests for: batch chaining (tampered middle batch, deleted batch, reordered
  batches all fail verification), signature valid/invalid/unsigned, export
  idempotency and refusal to overwrite, sealing both sources, and an emergency
  read that still succeeds with the checkpoint sink failing.
- All 31 `scripts/check-*.py` gates plus the new `check-no-blockchain.py`.
- Both `npm run test:gate`, the three typechecks, both builds.

## Later phases (outline; detailed before they start)

- **B.** Map every actor column and view from `users.wallet_address` to
  `users.id`; JWT `sub` = `users.id`; keep a legacy wallet mapping for sealed
  history; add real foreign keys where the column is a user reference.
- **C.** Staff: employee ID + password → JWT directly (existing Argon2id
  verifier; keystore and challenge signing removed). Patients: registration
  issues a one-time activation code; the patient sets their own password;
  optional TOTP; administrator reset. Step-up: TOTP (Class B); Class C
  challenge completed with TOTP or password. Remove `@polkadot/*`, `sp-core`,
  sr25519, recovery phrases, SS58 validation, `X-User-Id` wallet paths, wallet
  UI, and rewrite sign-in in `seed-browser-test-fixtures.ts`, `role-journeys.ts`,
  `cross-role-qualification.ts`, `synthetic-e2e-test.sh` and the Playwright suites.
- **D.** Backup the demo database, rebuild `api` and `nginx`, run every suite,
  role journeys and browser suites alone, and the trace gate with wallet terms
  enabled.

## Status

| Phase | State |
| --- | --- |
| A | Done (2026-09-30): chain removed, sealed audit stream; 938 API + 37 crypto tests, clippy, fmt, deny, all gates green except wallet terms (Phase C) and the pre-existing PatientNavigation colour classes |
| B | Not started |
| C | Not started |
| D | Not started |
