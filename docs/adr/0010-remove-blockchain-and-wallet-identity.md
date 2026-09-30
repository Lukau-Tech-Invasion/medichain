# ADR-0010: Remove the blockchain and wallet identity

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Founder
- **Supersedes:** [ADR-0003](0003-wallet-auth-with-jwt.md) (wallet authentication),
  [ADR-0004](0004-commitment-not-plaintext-on-chain.md) (its on-chain half; the
  off-chain capsule and its commitment stay),
  [ADR-0006](0006-federated-deployment.md) (the chain as the shared trust layer;
  per-hospital deployment stays), and
  [ADR-0008](0008-wallet-step-up-and-transaction-authorization.md) (wallet
  step-up and wallet transaction signing; the assurance classes stay).
- **Work plan:** [`docs/BLOCKCHAIN_REMOVAL_PLAN.md`](../BLOCKCHAIN_REMOVAL_PLAN.md)

## Context

MediChain used a Substrate chain in five ways: SS58 wallet addresses as user
keys; sr25519 signatures for sign-in and for step-up/transaction approval;
anchoring of access events and record/capsule commitments; transaction hashes
shown as proof; and a node, runtime, pallets and release pipeline to run it.

What that bought, measured on 2026-09-29:

- **No independent trust.** A ledger is worth its cost when replicas are run by
  organisations that do not trust each other (Kleppmann, *Designing
  Data-Intensive Applications*, ch. 12, pp. 532–533). The dev chain has one
  validator, and the Ministry-and-hospitals network ADR-0006 describes was never
  built. For most applications a forward-secure sealed log does the same job
  (Anderson, *Security Engineering* 3e, §20.7.6, p. 695).
- **Nothing anchored.** In the running stack `BLOCKCHAIN_ENABLED=false`, all 59
  audit batches were `pending`, and no access-log row carried a transaction hash.
- **New failure modes.** With the chain enabled, an emergency read answered 503
  (`PATIENT_WALLET_REQUIRED`, `CHAIN_AUDIT_UNAVAILABLE`) after the database audit
  had already committed; document upload did the same.
- **Wallets harmed users.** A patient's 12-word recovery phrase was shown on the
  registering clinician's screen, and a staff member who forgot their password
  lost their key permanently.

## Decision

1. **No blockchain.** No node, runtime, pallets, `subxt`, Substrate or Polkadot
   libraries, wallets, SS58 addresses or sr25519 signatures remain in the
   product.
2. **Tamper evidence is a sealed audit stream.** `access_logs` rows and
   `audit_events` rows (privacy-minimised: digests and ids, never PHI) are
   Merkle-batched by the single-instance job from WP8. Each batch's hash covers
   the previous batch's hash, is signed with Ed25519, and is exported as a
   checkpoint to an external sink. The sink is pluggable: a local directory now;
   one write-once cloud store (S3 Object Lock or Azure immutable storage — one,
   not both) later. Sealing and export are asynchronous. **Only the durable
   database audit write may gate a request**; a sealing or export failure never
   refuses a clinical read or write.
3. **Commitments are sealed, not anchored.** Emergency-capsule commitments,
   medical-record content digests and patient-registration digests are written
   as `audit_events` and sealed with everything else. Capsule verification
   compares the recomputed commitment with the sealed one.
4. **One user key.** `users.id` (UUID) is the only identifier of a user and the
   JWT `sub`. Actor columns hold it. Sealed or hashed historical data is never
   rewritten; historical wallet strings stay resolvable through a legacy mapping.
5. **Sign-in without keys.** Staff sign in with employee ID and password (the
   Argon2id verifier that already exists). Patients set their own password from
   a one-time activation code issued at registration — a clinician never sees a
   patient's secret. TOTP is optional for sign-in and required for privileged
   step-up. Password reset is an administrator action (for patients, in person at
   a facility).
6. **Assurance classes survive.** ADR-0008's Class A/B/C/E model stays. Class B
   is proved with TOTP. Class C keeps the server-side challenge bound to the exact
   request (session, method, path, body digest, resource state, single use); it is
   completed with a fresh TOTP code, or the current password when no TOTP is
   enrolled. Class E emergency access is unchanged.
7. **Federation.** Per-hospital deployment (ADR-0006, ADR-0007) stays. The chain
   as a shared trust layer is withdrawn. Cross-organisation trust, when it is
   needed, uses organisation signing keys and exchanged signed checkpoints.

## Consequences

**Gained.** No node to build, qualify or operate; no WASM toolchain; no chain
failure on the emergency path; forgotten passwords can be reset; patients own
their secrets from the first sign-in; far fewer dependencies; and ADR-0006's
open question about chain nodes replicating across borders disappears.

**Cost.** Each instance now holds a credential store — the objection ADR-0003
raised, accepted here: a stolen database yields Argon2id verifiers, and tamper
evidence rests on the signing key's custody and on the checkpoint sink being
write-once. Until a cloud write-once sink is configured, exported checkpoints
live on the same host and only prove what the host did not later rewrite.

**Not changed.** Per-patient authorization, care relationships, access reasons,
break-glass rules, consent in PostgreSQL, encrypted documents in IPFS, the
emergency capsule and its commitment, and the clinical "chain of custody"
records (a clinical term, unrelated to blockchains).
