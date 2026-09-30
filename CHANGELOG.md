# Changelog

All notable changes to MediChain are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-1.0 and does not yet make compatibility guarantees.

## [Unreleased]

### Removed (2026-09-29, ADR-0010)
- The blockchain layer: the Substrate node, runtime and three pallets, the
  `subxt` client, the chain-anchoring outbox, `docker-compose.blockchain.yml`,
  the node-release workflow and every chain script and document, plus the
  `BLOCKCHAIN_ENABLED`, `SUBSTRATE_*` and `MEDICHAIN_CHAIN_NETWORK`
  configuration. Chain fields are gone from the API responses.
- The `PATIENT_WALLET_REQUIRED`, `CHAIN_AUDIT_UNAVAILABLE` and
  `CHAIN_ANCHOR_UNAVAILABLE` refusals: an emergency read or document upload can
  no longer fail because a chain was down.

### Added (2026-09-29, ADR-0010)
- The sealed audit stream: `access_logs` and `audit_events` rows are
  Merkle-batched, hash-chained, signed with Ed25519 and exported as checkpoints
  by the single-instance job. New `AUDIT_SEAL_SIGNING_KEY`,
  `AUDIT_CHECKPOINT_SINK` and `AUDIT_CHECKPOINT_DIR` configuration, an
  `audit_checkpoints` volume, `seal_status` on API responses and an `audit_seal`
  block on `GET /api/health`. See `docs/AUDIT_LOG.md`.
- `scripts/check-no-blockchain.py`, a static gate against chain vocabulary
  returning to tracked files.

### Added
- Off-chain emergency capsule with on-chain commitment anchoring: versioned,
  revocable, encrypted under the server keyring, with field-level access logging
  and integrity verification on every break-glass read.
- Children's Act §129 mature-minor consent enforcement — age verified against the
  patient's recorded date of birth, with a required clinical maturity finding.
- Approval-gated retention execution: digest-bound approval tokens, processing
  restriction, and a deletion register carrying no clinical payload.
- Architecture Decision Records under `docs/adr/`.
- C4 and sequence diagrams in `docs/architecture.md`.
- `SECURITY.md`, `CONTRIBUTING.md`, `docs/SECURITY_ASSESSMENT.md`,
  `docs/GOVERNANCE_RECORD.md`, `docs/TECHNICAL_DEBT_REGISTER.md`.
- Synthetic end-to-end test harness (`scripts/synthetic-e2e-test.sh`, 40 assertions).

### Changed
- Company renamed to Lukau Invasion (Pty) Ltd throughout.
- `sqlx` upgraded 0.7.4 → 0.8.6, closing a reachable advisory (RUSTSEC-2024-0363).
- Retention assessment now distinguishes "did not run" from "found nothing"; the
  report endpoint returns 503 rather than reporting success for an assessment that
  could not complete.
- Dependency advisories triaged individually by reachability.

### Removed
- Plaintext `blood_type`, `organ_donor` and `dnr_status` from on-chain storage,
  and the events that republished them. See
  [ADR-0004](docs/adr/0004-commitment-not-plaintext-on-chain.md).
- Unreachable code holding staff personal data in plaintext.

### Fixed
- `ConsentGiverCapacity` wire format did not match its stored format, which meant
  the Children's Act consent checks were unreachable — requests were rejected
  during deserialisation before those checks ran.
- Emergency capsule revocation was not idempotent in the in-memory backend,
  allowing a second revoke to overwrite the original revocation's attribution.
- Test isolation: two tests raced on a process-global environment variable.
- Isolated test environment did not isolate — `container_name` is global in Docker
  Compose and `ports: []` does not override a merged list.

### Security
- Internal security assessment conducted against an isolated, synthetic-data-only
  environment. Process and outcomes: `docs/SECURITY_ASSESSMENT.md`.

## [0.1.0] — 2026-01

### Added
- Initial submission for the Rust Africa Hackathon 2026 (2nd place): Substrate
  pallets for patient identity, medical records and access control; Rust/Actix-web
  API; React doctor and patient applications.
