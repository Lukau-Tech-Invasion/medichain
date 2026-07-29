# Security Assessment — Process and Outcomes

© 2025–2026 Lukau Invasion (Pty) Ltd.

This describes **how** MediChain was security-assessed and **what changed as a
result**. It deliberately contains no vulnerability details, reproduction steps,
payloads or unresolved issues — publishing those would lower the cost of attacking
the system. Findings and evidence are retained privately.

## Why it was run

To establish, before any real patient data exists, whether the system's security
claims hold under adversarial review — and to fix what did not. The goal was
evidence, not a clean bill of health. "No findings" would have been a coverage
claim, never a safety claim.

## Boundaries

- Written internal authorisation naming the target, with a named operator.
- **Isolated environment only** — never a deployed instance. Distinct compose
  project, container names, volume, and credentials from any development stack.
- **Synthetic data only.** No real personal information at any point.
- **Third-party services excluded.** National-ID registries, SMS gateway and
  chain nodes were stubbed or disabled; API keys forced empty.
- Defined stop conditions, and a rehearsed kill switch.

## Method

Structured as a coverage ledger rather than a scan: each in-scope asset and
high-impact control became a numbered row with an assigned method, a risk tier,
and an expected evidence type. A row closes only with evidence.

Phases: inventory → trust boundaries → threat model → control baseline →
discovery → validation → remediation → retest.

Two rules shaped the results:

1. **A candidate is not a finding until independently reproduced.** Guessing
   inflates counts and wastes remediation effort.
2. **Root cause, not symptom.** Where a defect had siblings, the fix targeted the
   shared cause and the siblings were checked.

Standards referenced: NIST SP 800-115, OWASP ASVS, OWASP WSTG, OWASP API Security
Top 10, CVSS v4.0, NIST SSDF.

## Coverage

118 planned rows across the application, API, data, cryptography, blockchain,
privacy and resilience domains. 18 findings were raised and written up.

Static-tier review (source, configuration, dependencies, CI) is complete.
Active-tier testing against a live isolated instance is partially complete and
gated on environment readiness — that gate is enforced mechanically rather than by
judgement, and it is currently closed.

## What it changed

Representative, without identifying weaknesses in a way that assists an attacker:

- **On-chain plaintext health fields replaced with cryptographic commitments.**
  The largest change; see [ADR-0004](adr/0004-commitment-not-plaintext-on-chain.md).
- **National-ID digests keyed**, so a small identifier space is not brute-forceable.
- **A non-rotating credential replaced with short-lived signed tokens** on the
  emergency path.
- **Plaintext staff personal data removed** — the code holding it proved to be
  unreachable and was deleted outright rather than patched.
- **A dependency carrying a reachable CVE upgraded** (`sqlx` 0.7 → 0.8).
- **Dependency advisories triaged individually by reachability**, replacing a
  blanket suppression list.
- **A compliance control that reported success without running was fixed** — it
  now fails loudly instead of returning an empty result indistinguishable from a
  clean one.

## Honest limitations

- **Independent retest is owed.** Fixes were verified by the same party that wrote
  them. A different reviewer replaying the original conditions is still outstanding.
- **Active-tier coverage is incomplete.** A material share of planned rows require
  a live isolated environment and have not been executed.
- **Frontend coverage is weak** relative to the backend.
- **Four dependency advisories remain open** with no upstream fix available; they
  are re-checked rather than suppressed.
- **This is not a third-party audit.** It is a structured internal assessment. An
  external audit remains appropriate before production.

## What is not claimed

That MediChain is secure, unhackable, or free of vulnerabilities. Real patient
data is blocked behind the gates in
[`PRODUCTION_READINESS_GATES.md`](PRODUCTION_READINESS_GATES.md), four of which no
amount of engineering can close.
