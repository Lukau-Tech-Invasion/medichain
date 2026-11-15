# ADR-0010: Sealed audit stream and account identity

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Founder

## Context

MediChain needs three things that are easy to conflate:

1. **Tamper evidence.** Every access to a patient's record, and every
   consequential write, must leave a record that cannot later be rewritten
   without detection.
2. **One identity per person.** Every actor column, every session and every
   audit row must name a person the same way.
3. **Sign-in that real people can live with.** A clinician who forgets a
   password must be able to get back in; a patient's secret must never pass
   through a clinician's screen.

A shared replicated log is worth its cost only when its replicas are run by
organisations that do not trust each other (Kleppmann, *Designing
Data-Intensive Applications*, ch. 12, pp. 532–533). MediChain runs one instance
per organisation (ADR-0006, ADR-0007), so a forward-secure sealed log does the
job (Anderson, *Security Engineering* 3e, §20.7.6, p. 695).

## Decision

1. **Tamper evidence is a sealed audit stream.** `access_logs` rows and
   `audit_events` rows (privacy-minimised: digests and ids, never PHI) are
   Merkle-batched by one single-instance job (advisory lock, up to 1024 leaves).
   Each batch's hash covers the previous batch's hash, is signed with Ed25519
   (`AUDIT_SEAL_SIGNING_KEY`), and is exported as a checkpoint to a sink outside
   the database. The sink is pluggable: a local directory for development, an
   S3 bucket under Object Lock in production (written once per batch with
   `If-None-Match`; an existing different checkpoint is an error, never an
   overwrite). Sealing and export are asynchronous. **Only the durable database
   audit write may gate a request**; a sealing or export failure never refuses a
   clinical read or write.
2. **Commitments are sealed.** Emergency-capsule commitments, medical-record
   content digests and patient-registration digests are written as
   `audit_events` and sealed with everything else. Capsule verification compares
   the recomputed commitment with the sealed one.
3. **One user key.** `users.id` (UUID) is the only identifier of a user and the
   JWT `sub`. Actor columns hold it.
4. **Sign-in.** Staff sign in with employee ID and password (an Argon2id
   verifier of a client-derived proof). Patients set their own password from a
   one-time activation code issued at registration, so a clinician never sees a
   patient's secret. TOTP is optional for sign-in and required for privileged
   step-up. Password reset is an administrator action (for patients, in person
   at a facility).
5. **Assurance classes** are ADR-0008's: Class B is proved with TOTP; Class C is
   a server-side challenge bound to the exact request, completed with a fresh
   TOTP code or the current password; Class E emergency access is never gated.

## Consequences

**Gained.** No extra infrastructure to build, qualify or operate on the
emergency path; forgotten passwords can be reset; patients own their secrets
from the first sign-in; few dependencies.

**Cost.** Each instance holds a credential store: a stolen database yields
Argon2id verifiers. Tamper evidence rests on the custody of the signing key and
on the checkpoint sink being write-once; a checkpoint kept on the database's own
host proves only what that host did not later rewrite, which is why production
uses the Object Lock bucket.
