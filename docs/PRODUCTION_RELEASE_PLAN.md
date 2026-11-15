# MediChain production release plan

**Status: NOT READY for real patient data or public launch (2026-10-04).**
The local Docker stack is a synthetic-data demo. A successful build, healthy
containers, and a PostgreSQL dump do not close the release gates below. This
file records the required evidence and the order of work so no demo feature is
mistaken for a production control.

## Deployment design

1. Run one organisation per deployment in a South African data centre. Use a
   dedicated production PostgreSQL instance and separate development and
   staging databases containing synthetic data only. Build immutable images in
   CI; promote the same image digest to staging and production. Keep PostgreSQL,
   the API, and monitoring on private networks. Expose only TLS port 443.
2. Inject `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEYS`,
   `PATIENT_SEARCH_INDEX_KEY`, `NATIONAL_ID_HASH_KEY`, and
   `AUDIT_SEAL_SIGNING_KEY` from a managed secrets service at runtime. Give
   backup, application, and operator identities separate permissions. Record
   key versions and rotation/recovery procedures; never commit or bake secrets
   into an image. The current API accepts environment variables, so secret
   injection may set those variables in the container process.
3. Keep PostgreSQL as the system of record for clinical rows and encrypted
   document blobs. Use pgBackRest continuous WAL archiving, scheduled encrypted
   full/differential backups, and a separately credentialed off-site copy.
   Restore a backup into an isolated database and check application-level
   records, document decryptability, and the latest backup canary before
   trusting it. The existing Azure repo2 configuration is **not** proof of an
   immutable backup and has not been tested against a live account.
4. Create a dedicated, private S3 bucket in `af-south-1` for audit checkpoints
   and independently encrypted recovery snapshots. Enable bucket versioning,
   Object Lock, default **compliance** retention for a period approved in the
   retention policy, block public access, and server-side encryption. Grant the
   uploader only the minimum put/check permissions; an independent verifier
   gets read permissions. Upload each checkpoint once under its batch ID with
   a checksum and conditional create. Verify the returned version ID, checksum,
   retention mode/date, and retrieved bytes. Alert if local sealed batches are
   not confirmed in S3 within the approved lag. An S3 upload script and the
   external account are **not implemented/configured yet**: the API currently
   marks a checkpoint exported after writing the local filesystem sink.
5. Provision the signing key in the secret manager before the first production
   batch. Preserve its public key and key ID in a separate release record.
   Existing **unsigned demo batches cannot become historically signed** by
   adding a key later; start a new production audit stream from an empty,
   isolated production database. Never move the demo database into production.

AWS documents that S3 Object Lock requires versioning and that a protected
object key can still gain a **new version**. Therefore a locked bucket alone
does not prove that the latest key still contains the original checkpoint;
pin and verify the version ID and bytes. See the [Object Lock setup](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html),
[Object Lock behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html),
and [Africa (Cape Town) S3 endpoint](https://docs.aws.amazon.com/general/latest/gr/s3.html).

## Release gates and evidence

| Gate | Current state | Evidence required to close |
| --- | --- | --- |
| Production configuration | Partial: Compose now keeps internal ports private; API rejects demo mode, memory repositories, missing HTTPS origins, missing signing key, and default secrets | `python scripts/check-production-compose.py`, signed image digest, staging startup with production flags, TLS scan |
| Durable patient data | PostgreSQL and encrypted blobs work in the local stack; local dump verified | Save/read/reload/restart of every patient, clinician, lab, pharmacy, and emergency workflow against isolated staging PostgreSQL; DB failure must refuse writes |
| Audit and disclosure | Required disclosure writes fail closed; local batches are sealed, but the 99 existing demo batches were unsigned and local-only | Fresh signed production stream; S3 Object Lock upload and independent version-pinned verification; alert and recovery drill |
| Backups and recovery | pgBackRest scripts exist; local logical backup verified; remote account and restore proof absent | Continuous WAL observed, nightly backups, off-site copy, isolated restore including encrypted blobs and audit chain, measured RPO/RTO |
| Identity and access | JWT, per-handler authorization and CI gates exist; some step-up paths remain unused | Full role-by-role browser/API tests, revoked-session tests, transaction step-up tests, provider-backed ID verification, approved device enforcement |
| Clinical integrations | Some flows simulate or require external contracts/providers | Service agreements, live sandbox evidence for each enabled provider, signed webhooks, timeout/failure behavior, no silent success |
| Security and operations | Several static gates exist; full scan and monitoring exercise outstanding | SAST, secret/dependency scans, penetration test, alert drill, incident runbook, log/URL/error PHI review, patch/rollback rehearsal |
| Retention and privacy | Restriction exists; irreversible deletion and universal restriction enforcement are incomplete | Approved retention schedule, deletion and backup-expiry implementation/tests, privacy assessment and processor agreements |
| Governance | No production accounts or approvals supplied | Named legal entity and Information Officer; POPIA prior-authorisation/transborder assessment; South African health/privacy legal sign-off; clinical sign-off for emergency policy |

The seven legal/retention conditions in
[`PRODUCTION_READINESS_GATES.md`](PRODUCTION_READINESS_GATES.md) remain binding.
Its older chain-specific implementation notes are historical; ADR-0010 governs
the present architecture. Do not claim that every workflow is working merely
because the synthetic demo journey passes. Keep a dated test result and an
owner for every row before authorising real patient information.

## Immediate execution order

1. Finish code-owned failures revealed by the full Rust, frontend, and browser
   suites. Reconcile each failing test against the current product behavior;
   do not remove a failing safety assertion to obtain a green build.
2. Build and verify the immutable S3 checkpoint/backup path and provider-backed
   identity integration in staging, after accounts and data-processing terms
   exist. Keep unconfigured integrations visibly unavailable.
3. Exercise a complete staging restore, signed audit verification, key rotation,
   and incident/rollback drill. Capture timestamps, image digest, and outputs.
4. Obtain governance and clinical approvals. Only then permit a production
   deployment with real patient data.

## Verification snapshot (2026-10-04)

- Production Compose merges with the backup overlays and only port 443
  published. The self-falsifying `scripts/check-production-compose.py` gate
  detects an intentionally exposed database port, HTTP port, and missing WAL
  archive command. This proves configuration shape, not that an off-site
  account is working or a restore has succeeded.
- Eight focused API runtime-posture tests passed. The doctor safety gate passed
  43 files / 238 tests; the patient safety gate passed 19 files / 130 tests.
  Endpoint authorization, patient-data read audit, required-audit-result and
  store-durability gates passed.
- The full 931-test API run is **not green**. Against the isolated synthetic
  PostgreSQL database, several older in-memory endpoint tests returned 503;
  the first reproduced in isolation at `api/src/api_tests.rs:194`. The broad
  run was stopped to diagnose that common failure. Do not weaken the
  fail-closed audit requirement merely to satisfy those tests.
- The currently running demo API reported `ready=true` and `backend=postgres`.
  This is the previously built image, **not** a runtime test of the new
  production startup guard. No production image or browser end-to-end run was
  built this pass because the host had under 1 GB free.
