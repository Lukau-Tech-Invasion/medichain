---
name: documentation
description: >
  Documentation discipline for MediChain — README, rustdoc/docstrings, ADRs (Architecture
  Decision Records), CHANGELOG, threat model docs, and CLAUDE.md for AI assistants. Covers
  what to document, where, and the "WHY not WHAT" rule for code comments. Activate when the
  user says "write docs", "document this", "update the README", "add docstrings", "explain
  the architecture", "ADR", "changelog", "what does this code do", or proactively after any
  major feature ships — documentation written while the code is fresh is documentation that
  gets written.
---

# Documentation for MediChain

MediChain is open source, will outlive your memory of why each decision was made, and
will be reviewed by external auditors and possibly regulators. Documentation is not
optional polish — it's a load-bearing part of the system.

---

## The Documentation Hierarchy

```
1. CLAUDE.md       → architecture for AI assistants (you, future-you, Claude Code)
2. README          → how to set up, run, contribute (for humans)
3. ADRs            → WHY we chose X over Y (for future-you and reviewers)
4. THREAT-MODEL.md → security assumptions and adversaries
5. PRIVACY.md      → POPIA/HIPAA stance and data handling
6. CHANGELOG       → what changed between versions (for users + auditors)
7. Rustdoc/JSDoc   → what each function/struct does (for callers)
8. Inline comments → WHY this code (the code itself shows WHAT)
9. SECURITY.md     → how to report vulnerabilities responsibly
```

---

## CLAUDE.md (root of repo)

This file is the first thing an AI assistant reads. Make it count.

```markdown
# MediChain — Claude Briefing

You are working on **MediChain**, a blockchain-verified national health ID system
for South Africa. Built in Rust + Solana (Anchor) + TypeScript (React).

## Architecture (1-minute version)

- `crates/program/` — Solana on-chain program (Anchor framework). Trust root.
- `crates/backend/` — Rust HTTP API (axum). Holds encrypted PHI off-chain.
- `crates/nfc/` — NFC card writer/reader CLI.
- `crates/shared/` — types shared across crates (PatientId, BloodType, etc.).
- `frontend/` — TypeScript + React. Patient app, doctor portal, paramedic PWA.

## Non-negotiables

1. **No PHI on-chain.** Ever. Only hashes, pointers, public keys, audit entries.
2. **Every on-chain instruction has a `Signer` for the authority.**
3. **POPIA compliance.** South African law. See PRIVACY.md.
4. **3-second NFC tap-to-display.** The product promise.
5. **Tests required for every PR.** Failing test → fix → passing test → ship.

## Common commands

- `cargo nextest run` — run all Rust tests
- `anchor test` — Solana program integration tests
- `cd frontend && npm run dev` — dev server
- `npm run typecheck` — TS type check across frontend

## Where to learn more

- ADRs: `docs/adr/` — read these before changing architecture
- Privacy: `PRIVACY.md`
- Threat model: `THREAT-MODEL.md`
- Security policy: `SECURITY.md`
```

---

## README.md (project root)

Aimed at: a developer who landed here from GitHub and has 5 minutes.

Structure:
1. **One-line description** (the elevator pitch)
2. **Why** (why does this exist?)
3. **Status** (alpha / beta / production)
4. **Quick start** (clone, install, run)
5. **Architecture diagram** (one image, high-level)
6. **Documentation links** (to all the other docs)
7. **Contributing** (how to PR, code style, tests required)
8. **License** (MIT? Apache 2? Something else?)

Don't bury the lede. The first paragraph should answer "what is this and should I care?".

---

## ADRs — Architecture Decision Records

Every significant architectural choice gets an ADR. Format:

```markdown
# ADR-007: Use NTAG215 for emergency cards

## Date
2026-04-18

## Status
Accepted

## Context
We need NFC tags on physical patient cards for the emergency access flow.
Options are NTAG213 (144B), NTAG215 (504B), NTAG216 (924B), MIFARE Classic,
MIFARE DESFire.

## Decision
NTAG215.

## Reasoning
- Capacity (504B) comfortably fits our v1 capability token (~200B) with
  headroom for v2 (additional fields, longer signatures).
- Universal phone support — every NFC-capable phone reads NTAGs without
  app installation.
- Cheap (~R3 in 1k+ qty) — keeps card issuance economically viable.
- No key management overhead (vs MIFARE Classic which needs sector keys).
- Lockable to read-only after issuance (CC byte) — prevents tampering.

## Consequences
**Positive:** Low cost, broad compatibility, simple workflow.
**Negative:** Tags can be cloned (no authentication on the tag itself).
We mitigate via the capability token's signature + on-chain revocation list.

## Alternatives considered
- MIFARE DESFire EV3: secure, supports auth, but ~10x cost and limited
  iPhone support. Considered for v2 enterprise tier.

## Revisit when
- We add a "high-security" card tier for VIP patients
- Tag cloning becomes a documented threat in production
```

ADRs live in `docs/adr/0001-xxx.md`, numbered sequentially, never edited after
acceptance — write a new one that supersedes if the decision changes.

---

## Rustdoc — Function and Type Documentation

```rust
/// A patient's on-chain identity, derived from their wallet pubkey.
///
/// `PatientId` is the canonical reference to a patient throughout MediChain,
/// used as the seed for [`PatientAccount`] PDAs and as the key in audit logs.
/// It is **not** PII — the pubkey alone reveals nothing about the person.
///
/// # Example
/// ```
/// let id = PatientId::from_pubkey(&wallet.pubkey());
/// let (pda, bump) = id.account_pda(&program_id);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PatientId(pub [u8; 32]);

impl PatientId {
    /// Derives the PDA address for this patient's account.
    ///
    /// Returns `(address, bump)`. Store the `bump` in the account itself
    /// to avoid re-derivation costs on subsequent reads.
    ///
    /// # Errors
    /// Returns `Err(MediChainError::PdaNotFound)` if no valid bump exists
    /// for the given seed combination — extremely rare in practice.
    pub fn account_pda(&self, program_id: &Pubkey) -> Result<(Pubkey, u8)> {
        // ...
    }
}
```

Run `cargo doc --open` to see your docs rendered. If they look bad, they ARE bad.

---

## Inline Comments — WHY, not WHAT

```rust
// ❌ Comments the obvious — adds nothing
// Increment counter by 1
counter += 1;

// ❌ Repeats the function name
// Get the patient
fn get_patient() { ... }

// ✅ Explains WHY
// Bump the schema version BEFORE saving so a partial write
// fails the next migration check rather than silently corrupting state.
schema_version += 1;
save_account(&account)?;

// ✅ Explains a non-obvious constraint
// We use checked_add here because `expires_at` is patient-supplied
// and could otherwise overflow on durations near i64::MAX.
let expires_at = now.checked_add(duration_seconds)
    .ok_or(MediChainError::DurationOverflow)?;

// ✅ Documents a workaround for an external bug
// Solana web3.js < 1.92 returns lowercased base58 for some pubkeys.
// We normalise to checksummed form before comparison.
let normalised = pubkey_str.to_uppercase();
```

If a comment just restates the code, delete it. If a comment requires the code to be
understood, the code probably needs simplifying.

---

## CHANGELOG (Keep a Changelog format)

```markdown
# Changelog
All notable changes to MediChain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.4.0] - 2026-05-15
### Added
- Emergency access via NFC + QR (paramedic PWA reader)
- On-chain `EmergencyAccessLog` for paramedic-tier reads

### Changed
- `ConsentRecord.scope` is now a u32 bitmap (was u8) to support new categories

### Security
- Audit fix: `grant_consent` now requires patient signer (was constraint-only)

### Migration notes
- Existing devnet ConsentRecords need migration; see scripts/migrations/0004.ts
```

The auditor will read this. The user reading the release notes will read this.
Take it seriously.

---

## SECURITY.md

```markdown
# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in MediChain, please report it
privately to security@medichain.app — do NOT open a public GitHub issue.

We aim to:
- Acknowledge within 48 hours
- Provide a fix or mitigation within 14 days for critical issues
- Credit you in our security advisory unless you prefer anonymity

## Bug Bounty
We do not yet have a formal bounty program but reward responsible disclosure
with public credit and (where appropriate) project swag.

## Scope
In scope:
- The on-chain Solana program (deployed program ID listed in DEPLOYMENTS.md)
- The MediChain backend API
- Patient and paramedic apps

Out of scope:
- Social engineering of MediChain staff
- DoS attacks against testnet/devnet
- Issues in third-party dependencies (report upstream)
```

---

## Documentation Checklist (per PR)

For every PR, ask:

- [ ] If this changes architecture, is there an ADR?
- [ ] If this adds a public function/type, does it have rustdoc/JSDoc?
- [ ] If this changes user-visible behaviour, is the CHANGELOG updated?
- [ ] If this changes how to set up the project, is the README updated?
- [ ] If this affects security posture, is THREAT-MODEL.md or SECURITY.md updated?
- [ ] If this affects PHI handling, is PRIVACY.md updated?
- [ ] If this affects how Claude/AI should reason about the code, is CLAUDE.md updated?

Documentation is part of "done." Code without docs is half-built.
