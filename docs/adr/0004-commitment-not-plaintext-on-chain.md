# ADR-0004: On-chain commitments, never plaintext health data

- **Status:** Accepted
- **Date:** 2026-07-29
- **Deciders:** Founder, informed by an external POPIA / National Health Act / Children's Act legal review (2026-07-28)

## Context

The original design stored three fields in the clear in Substrate pallet storage:

- `pallet-medical-records::HealthRecord.blood_type`
- `pallet-patient-identity::Identity.organ_donor`
- `pallet-patient-identity::Identity.dnr_status`

The reasoning was defensible on its face: a paramedic must read these in under
three seconds, and a decrypt round-trip against a patient-held key is impossible
when the patient is unconscious. Storing them on-chain made them readable
without any key exchange. The project documented this as a deliberate exception
to its own "hashes and pointers only" rule.

A legal review overturned it. The findings that mattered:

1. `blood_type`, `organ_donor` and `dnr_status` are **health-related special
   personal information** under POPIA.
2. POPIA grants rights to **correction** and **deletion**, and imposes
   **retention limitation**. An immutable ledger cannot honour any of the three.
   Not "does so imperfectly" — cannot, structurally.
3. **Pseudonymity does not cure it.** The Information Regulator's
   de-identification standard turns on whether data can be re-linked to a person
   "by a reasonably foreseeable method". This project already accepts that an
   on-chain `AccountId` may later correlate to a real identity.
4. **A permissioned chain does not fix it either.** Permissioning controls who
   reads; it does nothing about deletion, correction or retention.
5. Emitted **events** are recorded in block data, so `OrganDonorStatusUpdated`
   and `DnrStatusUpdated` republished exactly what the storage change removed.

The uncomfortable part: the original design was not careless. It traded a real
clinical requirement against a legal one and got the trade wrong, because the
legal constraint was structural rather than a matter of degree.

## Options considered

**A. Keep plaintext on-chain, accept the risk.**
Preserves the 3-second read with no new machinery. Rejected: not a risk that can
be accepted, because the obligation cannot be met later. Deleting from an
immutable ledger is not a matter of effort.

**B. Move to a permissioned chain.**
Narrows who can read. Rejected per finding 4 — it addresses confidentiality only,
and the problem is deletion and correction.

**C. Encrypt the values on-chain.**
Ciphertext is still an immutable record of personal information, and key
destruction as a deletion mechanism is contested. Rejected: it converts a clear
violation into an arguable one, which is worse than a clean design.

**D. Commitment on-chain, encrypted capsule off-chain.** *(chosen)*
Publish only a 32-byte digest plus a version. Hold the values off-chain where
they can be corrected, superseded and deleted.

## Decision

Store only a **commitment and a version** on-chain. The values live in an
off-chain capsule, encrypted under the **server** keyring rather than a
patient-held key — so an authorised break-glass read decrypts instantly without
the patient being reachable, which is what the clinical requirement actually
needed.

- `HealthRecord.blood_type` → `emergency_capsule_commitment: [u8; 32]` +
  `emergency_capsule_version: u32`
- `Identity.organ_donor` / `Identity.dnr_status` → **removed entirely**
- The two self-service writers (`set_organ_donor_status`, `set_dnr_status`) are
  replaced by one provider-gated `set_emergency_capsule_commitment` that rejects
  stale versions
- Their call indices (2, 3) are **permanently reserved, never reused**, so a
  stale client cannot silently bind to a different extrinsic
- The corresponding events were **removed**, not just the storage

The commitment is SHA3-256 over domain-separated, length-prefixed fields, so no
two distinct capsules can share a digest and no field-boundary ambiguity exists
(`"ab"+"c"` must not hash as `"a"+"bc"`).

## Consequences

**Gained.** Correction, deletion and retention become possible. Values are
versioned and revocable. Tamper-evidence is actually *stronger* than before: the
old design published values but gave no way to detect that the off-chain copy had
been altered, because there was no off-chain copy to compare. Provenance the old
plain enums could not carry — who verified a blood type and when, which document
backs a DNR, whether it was revoked — now travels with the capsule.

**Cost.** More moving parts: a capsule table, an access log, an anchoring path,
and a verification step on every read. Integrity now depends on the anchoring
having succeeded, so `chain_finalized` must be checked rather than assumed — a
hash alone no longer proves anchoring.

**Cheap only because it was done now.** No chain state existed yet: the node was
not producing blocks with real data, `BLOCKCHAIN_ENABLED` defaulted to false, and
submissions returned placeholders. There was no storage migration to write and no
historical data to rewrite. The same change against a live chain carrying real
patient records would have ranged from expensive to impossible. **That is the
general lesson: the window for fixing an immutable-storage decision closes the
moment the first real record is written.**

**Residual risk.** Accepted for synthetic-data testing only; this is a hard
blocker for real patient data until the full redesign is verified. Cross-border
node replication remains a separate open question — see
[`GOVERNANCE_RECORD.md`](../GOVERNANCE_RECORD.md).

## Verification

- `api/src/emergency_capsule.rs` — capsule, commitment, verification, access log
- `api/migrations/20260729000004_emergency_capsules.sql` — storage
- 13 tests covering digest determinism, field-boundary ambiguity, `None` vs
  `Some("")` distinguishability, revocation semantics, and version monotonicity
