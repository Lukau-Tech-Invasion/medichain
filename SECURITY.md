# Security Policy

MediChain handles health information. Security here is treated as a property to be
evidenced, not asserted.

## Reporting a vulnerability

**Do not open a public issue.** Email **kkgawatlh9@gmail.com** with:

- what you found and where,
- how to reproduce it,
- what an attacker could achieve.

You will get an acknowledgement within **72 hours** and an assessment within
**7 days**. Please allow 90 days before public disclosure so a fix can ship. We
will credit you unless you ask us not to.

This is a pre-production system with no real patient data. Please do not test
against any deployed instance without written authorisation; run it locally
instead — see [Quick start](README.md#quick-start).

## Supported versions

Pre-1.0. Only `main` receives fixes.

## Design invariants

These are the rules the system is built to hold. A violation is a bug regardless
of whether it is exploitable today.

| # | Invariant |
|---|---|
| 1 | **No personal health information on-chain.** Only hashes, commitments, pointers, public keys and audit entries. |
| 2 | **Roles come from the server-side user record**, never from a client-supplied header. `X-User-Id` identifies; it does not authorise. |
| 3 | **Parameterised SQL only.** Zero string concatenation in queries. |
| 4 | **No hardcoded secrets.** All keys and tokens come from the environment; `validate_production_secrets()` fails the boot on demo defaults outside demo mode. |
| 5 | **Every emergency access is logged** with who, why, when, under which grant, and which fields were revealed. |
| 6 | **PHI never crosses an external boundary.** National-ID calls send a digest; SMS carries no clinical content; the chain receives hashes. |
| 7 | **Fail toward care, log loudly.** An integrity-check failure returns the clinical data and records the discrepancy rather than blanking the screen on a responder. |

## Cryptography

| Purpose | Primitive | Note |
|---|---|---|
| Document / capsule encryption | ChaCha20-Poly1305 (AEAD, 256-bit) | Emergency capsules are encrypted under the **server** keyring so a break-glass read needs no patient interaction |
| Key derivation | Argon2id | Memory-hard |
| Integrity commitments | SHA3-256 | Domain-separated and length-prefixed, so no two distinct inputs share a digest |
| National ID digests | SHA3-256, **keyed** | Keyed so digests are not brute-forceable from a small identifier space |
| Signatures | Sr25519 (Schnorrkel) | Substrate-native |
| Sessions | JWT HS256 | 1 h access, 7 d refresh |
| Step-up auth | TOTP, RFC-6238 | For ePHI access |
| Key material | `zeroize` on drop | |

Keys are versioned (`EncryptionKeyring`) so rotation does not orphan existing
ciphertext.

## Secure development practice

- **NASA Power of 10** — no recursion, bounded loops, functions ≤ 60 lines,
  assertions on invariants.
- **Zero-warnings policy.** This is a security control, not tidiness: dead-code
  warnings are what revealed two features that were fully written, tested, and
  wired to nothing.
- **Supply chain** — `cargo-deny` with per-advisory reachability review, plus SBOM
  generation. Advisories are triaged by whether the flagged path is actually
  reachable, not by version number alone.
- **CI** on every branch, with PostgreSQL provisioned for repository tests.

## Assessment history

An authorised internal security assessment has been conducted against an isolated,
synthetic-data-only environment. Its process and outcomes are summarised in
[`docs/SECURITY_ASSESSMENT.md`](docs/SECURITY_ASSESSMENT.md).

Following the standard disclosure principle, **target-specific findings,
reproduction steps and evidence are not published** — that material would lower
the cost of attacking the system and is retained privately.

## What this project does not claim

It is not "unhackable", "fully secure" or free of vulnerabilities — no assessment
can establish those. Real patient data is currently **blocked** behind seven
documented gates; see
[`docs/PRODUCTION_READINESS_GATES.md`](docs/PRODUCTION_READINESS_GATES.md).
