---
name: code-audit
description: Deep single-file audit or diff/PR bug review across 5 axes (functional bugs, security, performance, UX, architecture). Use when reviewing any file for correctness and quality, starting a daily audit rotation, or reviewing changes before a PR merge.
---

# Code Audit for MediChain

A bug in MediChain is not a cosmetic issue — it can mean a paramedic sees wrong allergies,
PHI leaks on-chain, or an attacker bypasses RBAC. Every audit uses the same five axes.

---

## When to Use

**Mode A — Single-file deep audit**
Invoke as `/code-audit <path/to/file>` (relative to repo root).
Omit the path and the agent picks the next file not yet in `docs/AUDIT_LOG.md`.
Performs a full, line-by-line audit of ONE file across all five axes.

**Mode B — Diff / PR bug review**
Invoke as `/code-audit diff` (working-tree diff) or `/code-audit <PR#>` (GitHub PR via `gh`).
Focuses on correctness bugs introduced by the change, with the same five axes scoped to
changed lines. Prefer high-confidence findings over speculative ones.

---

## Repo Context (always keep in mind)

- **Stack:** Rust/Actix-web 4.9 API (`api/`), React 18 + Vite + Tailwind + Zustand frontend
  (`client/`), Substrate pallets (`pallets/`), PostgreSQL 16 (70+ tables, 9 migrations),
  IPFS for encrypted medical documents, `medichain-crypto` (ChaCha20-Poly1305 / Argon2id).
- **Auth:** `X-User-Id` header (SS58 wallet address). Signature verification is implemented
  but disabled in demo mode (`IS_DEMO=true`). Role hierarchy:
  Admin > Doctor/Nurse > LabTechnician/Pharmacist > Patient.
- **Storage:** Dual — in-memory default (dev/demo), PostgreSQL via `MEDICHAIN_STORAGE=postgres`.
  Both implement the same repository traits. Drift between the two is a known risk.
- **Blockchain:** `api/src/blockchain.rs` currently returns placeholder SHA3-256 hashes.
  Real extrinsics via `subxt` are pending. Pallets are ready; client integration is not.
- **Critical rules:**
  - No PHI on-chain — only hashes, IPFS pointers, public keys, and audit entries.
  - RBAC on every data-modifying endpoint.
  - Parameterized SQL only (`sqlx::query_as` with bound params — zero string concat in SQL).
  - NASA Power-of-10: no recursion, bounded loops, functions ≤ 60 lines, no dynamic
    allocation after init, assertions for invariants.
  - No hardcoded secrets — all keys/tokens from environment variables.

---

## The Five Axes

### 1. Functional Bugs
- Logic errors: wrong conditions, inverted boolean, wrong operator.
- Off-by-one: loop bounds, index arithmetic, pagination cursors.
- Unhandled cases: missing enum arms, unwrap/expect that can panic, missing `None` branch.
- Broken error handling: errors silently swallowed, wrong error type propagated, `.unwrap()`
  in production paths.
- Race conditions / TOCTOU: check-then-act on shared state, missing locks.
- Incorrect async/await: blocking in async context, missing `.await`, wrong executor.
- State bugs: stale cached values, double-mutation, inconsistent field updates.

### 2. Security Issues
- PHI leakage: does any response body, log line, or error message include raw patient data
  that should stay off-chain or encrypted?
- Header trust: is `X-User-Id` or `X-Provider-Role` used to authorize actions without
  validating a signature? (Especially critical when `IS_DEMO=false`.)
- Missing RBAC: every `POST`, `PUT`, `PATCH`, `DELETE` endpoint must check the caller's
  role before mutating data. Is the check present and correct?
- SQL injection: any `format!()`, string concat, or interpolation building a SQL string?
- Hardcoded secrets: API keys, passwords, or tokens in source — not from env.
- Input validation: unbounded string lengths, negative numbers where positive required,
  missing field validation before DB write.
- Auth/signature gaps: endpoints reachable without a valid token in non-demo builds?
- XSS / injection (frontend): `dangerouslySetInnerHTML`, unescaped user content in JSX,
  missing `Content-Security-Policy` headers.

### 3. Performance Issues
- N+1 queries: a loop that issues a DB query per iteration — should be a single join/batch.
- Unbounded loops or allocations: no upper bound on iteration count or collection size
  (violates NASA Power-of-10).
- Needless clones: `.clone()` on large structs where a reference or move would do.
- Blocking in async: `std::thread::sleep`, synchronous I/O, `std::fs` inside `tokio` tasks.
- Missing DB indexes: columns used in WHERE / ORDER BY / JOIN without an index in migrations.
- Large React re-renders: components re-rendering on every parent update without
  `React.memo`, `useMemo`, or `useCallback` where warranted.
- Missing memoization: expensive derivations recomputed on every render.

### 4. UX Issues (frontend files)
- Missing states: no loading spinner, no empty-state message, no error boundary or
  error message shown to the user.
- No feedback on actions: form submits, deletes, or saves with no success/failure toast.
- Hardcoded strings: user-visible text not going through the i18n layer.
- Inaccessible markup: interactive elements missing `aria-label`, form fields missing
  `<label>`, modals missing `role="dialog"` and focus management.
- Unlocalized data: dates, currency amounts, or phone numbers formatted without locale
  awareness.
- Confusing flows: multi-step forms with no back/cancel, destructive actions without
  confirmation dialogs, no indication of required vs optional fields.

### 5. Architecture Issues
- Functions > 60 lines: violates NASA Power-of-10 — split them.
- Files doing too much: a single file > ~500 lines with unrelated responsibilities
  (e.g., `clinical_endpoints.rs` at 16K lines is a known issue).
- Leaky abstractions: internals of one module directly manipulating the internals of another.
- Duplicated logic: same validation, transformation, or query written in two places.
- Missing tests: new logic with zero test coverage — flag it.
- Dual-storage drift: does the memory repository implementation diverge from the PostgreSQL
  one in a way that causes different behavior?
- Type sharing gaps: types defined in both `client/` and `api/` that should live in
  `client/shared/` or be auto-generated from the OpenAPI spec.

---

## Severity Rubric

| Severity | Definition |
|----------|-----------|
| **Critical** | Patient safety, security breach, or data loss. Requires immediate fix before any release. Examples: PHI leakage, auth bypass, missing RBAC on a write endpoint, panic in a production path. |
| **High** | Significant correctness or security issue that could cause wrong clinical data, data corruption, or silent failures in production. |
| **Medium** | Issue that degrades reliability, performance, or security posture but does not immediately threaten patient safety or data. |
| **Low** | Code quality, minor UX gap, or tech-debt item with limited production impact. |
| **Nit** | Style, naming, or trivial cleanup. No behavioral impact. |

---

## Output Format

For each finding, output one block:

```
[SEVERITY] · [AXIS] · file:line
Problem: <what is wrong>
Risk:    <why it matters in this codebase>
Fix:     <concrete suggested fix, ideally with a code snippet>
```

After all findings, end with:

```
Verdict: <one sentence overall assessment>
Top action: <the single highest-priority fix the author should do first>
```

---

## After a Mode A Audit

1. Append a row to `docs/AUDIT_LOG.md` with: date, file path, count of findings by severity,
   top finding (one line), and status `Audited`.
2. Do NOT fix anything in the file unless the user explicitly asks. Audit first, fix on request.
3. Do not commit or push — the user is the sole committer.

---

## Reminders

- Never commit or push changes; the user is sole committer and manages all git history.
- When picking the next file for Mode A (no arg), check `docs/AUDIT_LOG.md` for the last
  audited file and move to the next logical file (e.g., alphabetically within the same
  directory, or the next highest-risk file by size/complexity).
- Prefer high-confidence findings. Flag uncertainty explicitly with `(uncertain)` rather
  than omitting the finding entirely.
- For Mode B, only report findings introduced or made worse by the diff — not pre-existing
  issues unrelated to the change (mention those separately at the end if significant).
