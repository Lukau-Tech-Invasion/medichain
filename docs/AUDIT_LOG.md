# MediChain Audit Log

This file covers two different things that share the word "audit":

1. [The sealed runtime audit stream](#the-sealed-runtime-audit-stream) — how the
   running system makes its own access and audit records tamper-evident
   ([ADR-0010](adr/0010-sealed-audit-stream-and-account-identity.md)).
2. [The code audit log](#the-code-audit-log) — the rolling record of source-file
   reviews.

---

## The sealed runtime audit stream

Tamper evidence in MediChain is a **sealed audit stream**: rows are batched,
each batch is chained to the one before it, signed with Ed25519, and exported as
a checkpoint to a sink outside the database (on AWS, an S3 bucket under Object
Lock, written once per batch).

### What is sealed

| Source | Rows | Leaf encoding |
| --- | --- | --- |
| `access_logs` | every row: who opened which record, why, when, and which fields were shown | `medichain.audit.leaf.v1` (unchanged from the earlier batching work) |
| `audit_events` | privacy-minimised events: event type, aggregate id, payload hash, payload JSON **without PHI** | `medichain.audit.event.v1` |

Three events carry the commitments the ledger used to hold. Each is written in
the same transaction as the record it describes:

- `emergency_capsule_published` — capsule id, version, commitment (hex)
- `medical_record_stored` — record id, content digest
- `patient_registered` — patient id, registration digest

Capsule verification compares the recomputed commitment with the sealed one.
Individual access events are not sealed separately: the `access_logs` row is
already a leaf.

### How a batch is made

A single-instance background job (advisory lock, so two API instances never seal
at once) takes up to **1024 unsealed leaves** from both sources and, in one
transaction:

1. builds the Merkle root over the leaves;
2. computes `batch_hash = SHA3-256("medichain.audit.batch.v1\0" ‖ id ‖ first_seq ‖
   last_seq ‖ leaf_count ‖ merkle_root ‖ prev_batch_hash)`, fixed-width and
   length-prefixed, where `prev_batch_hash` is the previous batch's `batch_hash`
   (absent for the first batch);
3. signs `batch_hash` with **Ed25519** and records the signing key id.

Because each hash covers its predecessor, a tampered middle batch, a deleted
batch and a reordered pair all fail verification. Batches left `pending` by the
earlier scheme are sealed in id order before new ones are built.

### Export

Sealed batches are written, in id order, as `<AUDIT_CHECKPOINT_DIR>/<batch_id>.json`
(all header fields, signature, key id) using a temp file and an atomic rename.
A file that already exists with different content is an **error, never an
overwrite**. A batch's status runs `pending` → `sealed` → `exported`.

Verify exported checkpoints with `scripts/verify-audit-checkpoints.py`.

### It is never on the request path

Handlers only write their rows inside their existing transaction, and keep
failing closed when *that* write fails (`AUDIT_PERSISTENCE_REQUIRED`). A sealing
or export failure never refuses a clinical read or write — an emergency read
still succeeds with the checkpoint sink down. Sealing lag is visible instead:
`GET /api/health` and the dashboards report
`audit_seal: { unsealed_events, last_sealed_at, last_exported_at, sink, signing }`.

### Configuration

| Variable | Meaning |
| --- | --- |
| `AUDIT_SEAL_SIGNING_KEY` | 64 hex characters (an Ed25519 seed). Required outside demo mode. In demo mode, unset means batches are sealed **unsigned** and verification says so. |
| `AUDIT_CHECKPOINT_SINK` | `none` or `filesystem`. Production refuses `none`. |
| `AUDIT_CHECKPOINT_DIR` | Absolute path, required with `filesystem`. The Docker stack mounts the `audit_checkpoints` volume for it. |

### What it does and does not prove

- A verifier holding the public key (`seal_key` in `GET /api/patients/{id}/verify`)
  can prove the exported batches are unaltered, complete and in order, and that
  they were signed by the key holder.
- **Custody of the signing key** and **write-once storage for the sink** carry the
  weight. Until a cloud write-once sink (S3 Object Lock or Azure immutable
  storage — one, not both) is configured, exported checkpoints live on the same
  host as the database and prove only what the host did not later rewrite.
- No PHI enters a leaf, a batch or a checkpoint: only ids, digests and
  privacy-minimised event payloads.

---

## The code audit log

This log tracks the rolling daily code audit driven by the `/code-audit` skill. One file is
audited per session across five axes: functional bugs, security, performance, UX, and
architecture. The skill appends a row here automatically after each Mode A audit. Do not
edit rows manually unless correcting an obvious mistake.

To trigger an audit: run `/code-audit <path/to/file>` (one specific file) or `/code-audit`
(agent picks the next un-audited file). To review a diff or PR: `/code-audit diff` or
`/code-audit <PR#>`.

| Date | File | Critical | High | Medium | Low | Top finding | Status |
|------|------|----------|------|--------|-----|-------------|--------|
| 2026-06-09 | — | — | — | — | — | Example row — replace with first real audit | example |
