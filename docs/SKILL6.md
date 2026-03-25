---
name: refactoring
description: >
  Safe, incremental code refactoring for MediChain — improving structure without changing
  behaviour. Covers the "tests first, then refactor" rule, extracting functions, taming
  long Rust modules, splitting Anchor programs, decomposing React components, and knowing
  when to leave it alone. Activate when the user says "this is messy", "clean this up",
  "refactor", "duplication", "extract", "this function is too long", "technical debt", or
  when a Rust file is over 300 lines / a function over 40 lines / a React component over
  200 lines. NEVER refactor without tests in place first — that's just rewriting.
---

# Refactoring for MediChain

Refactoring = changing the structure of code without changing its behaviour.
The "without changing its behaviour" part is what tests enforce.

**No tests, no refactor.** That's not refactoring, that's rewriting and hoping.

---

## The Iron Rule

```
1. Are there tests covering the code I'm about to change?
   → NO: write tests first. Then refactor.
   → YES: continue to step 2.
2. Do the tests pass before you start?
   → NO: stop. Fix the broken tests first.
   → YES: continue to step 3.
3. Make ONE small change.
4. Run the tests.
   → FAIL: revert or fix immediately. Don't pile on more changes.
   → PASS: commit. Repeat from step 3.
```

Tiny commits. Each one passes tests. If you have to throw away work, you throw away
minutes, not days.

---

## When to Refactor

**Yes:**
- Adding a feature would be cleaner if existing code were restructured first
- A bug recurs in the same module repeatedly (the design invites bugs)
- Reading the code takes you longer than writing similar code from scratch
- You're afraid to change a file (fear is a code smell)

**No (or not yet):**
- "It just looks ugly" but it works and isn't being touched
- A file you don't currently need to modify
- Code an external auditor is mid-review of
- Right before a deadline (refactor → bugs → missed deadline)

---

## Smells and Their Cures

### Long function (Rust > 40 lines, React > 50 lines)
Extract sub-functions. Each one named after WHAT it does (the "why" lives in the
caller).

```rust
// Before
pub fn grant_consent(state: &State, req: GrantRequest) -> Result<Response> {
    // 80 lines of validation, lookup, build tx, send, log, format response...
}

// After
pub fn grant_consent(state: &State, req: GrantRequest) -> Result<Response> {
    let validated = validate_grant_request(&req)?;
    let patient = lookup_patient(state, &validated.patient_id)?;
    let tx = build_grant_consent_tx(&patient, &validated)?;
    let signature = send_and_confirm(state, tx)?;
    log_consent_grant(state, &validated, &signature)?;
    Ok(format_grant_response(&validated, &signature))
}
```

The top-level function now reads like a table of contents.

### Duplication (the same shape three times)
Extract once. The third occurrence is the trigger — twice can be coincidence, three
times is a pattern.

```rust
// Three places doing the same thing → one helper
fn require_verified_doctor(account: &DoctorAccount) -> Result<()> {
    if !account.is_verified {
        return Err(MediChainError::DoctorNotVerified);
    }
    if account.suspended_until > Clock::get()?.unix_timestamp {
        return Err(MediChainError::DoctorSuspended);
    }
    Ok(())
}
```

### "Stringly typed" parameters
Replace with newtypes (see `rust-best-practices` skill).

```rust
// Before
fn fetch(patient: String, doctor: String) -> Record { ... }

// After
fn fetch(patient: PatientId, doctor: DoctorId) -> Record { ... }
```

### A struct doing too many things
Split by concern. Patient identity ≠ patient PHI ≠ patient consents.

### Nested conditionals 3+ deep
Use early returns (`?` in Rust, guard clauses everywhere):

```rust
// Before
fn process(req: Req) -> Result<Resp> {
    if req.is_valid() {
        if let Some(user) = lookup(req.user_id) {
            if user.is_active {
                if user.has_permission(&req.action) {
                    return Ok(do_thing(req, user));
                } else {
                    Err(...)
                }
            } else { Err(...) }
        } else { Err(...) }
    } else { Err(...) }
}

// After
fn process(req: Req) -> Result<Resp> {
    req.validate()?;
    let user = lookup(req.user_id).ok_or(NotFound)?;
    if !user.is_active { return Err(Inactive); }
    if !user.has_permission(&req.action) { return Err(Forbidden); }
    Ok(do_thing(req, user))
}
```

### A React component over 200 lines
Split by responsibility. UI vs data-fetching vs business logic.

```tsx
// Before: ConsentManager.tsx (350 lines doing fetching, filtering, rendering, modals…)

// After:
// hooks/useConsents.ts            ← data fetching + mutations
// components/ConsentList.tsx      ← rendering of a list
// components/ConsentRow.tsx       ← single-row UI
// components/RevokeConfirmModal.tsx
// features/consent/ConsentManager.tsx ← composition only, ~50 lines
```

### Magic numbers / strings
Name them. Constants explain themselves.

```rust
// Before
if duration > 31_536_000 { return Err(...) }

// After
const MAX_CONSENT_DURATION_SECS: i64 = 365 * 86_400;  // 1 year
if duration > MAX_CONSENT_DURATION_SECS { return Err(...) }
```

---

## Specific MediChain Refactor Patterns

### Splitting an Anchor Program File
A single `lib.rs` over 600 lines is hard to navigate. Split:
```
crates/program/src/
├── lib.rs                      ← #[program] mod, declares instructions
├── state/
│   ├── mod.rs
│   ├── patient.rs              ← #[account] PatientAccount + impl
│   ├── doctor.rs
│   └── consent.rs
├── instructions/
│   ├── mod.rs
│   ├── initialize_patient.rs   ← Accounts struct + handler
│   ├── grant_consent.rs
│   └── use_emergency_token.rs
├── error.rs
└── constants.rs
```

Each instruction file: ~50-150 lines, focused on one operation.

### Decomposing the Backend
```
crates/backend/src/
├── main.rs                     ← bootstrapping only
├── app.rs                      ← router assembly
├── handlers/
│   ├── mod.rs
│   ├── auth.rs
│   ├── consents.rs
│   └── emergency.rs
├── services/
│   ├── chain.rs                ← all RPC + program calls
│   ├── crypto.rs               ← encryption / decryption of PHI
│   └── audit.rs
├── middleware/
│   ├── auth.rs
│   ├── rate_limit.rs
│   └── idempotency.rs
└── error.rs
```

Handlers do request parsing + response formatting. Services do the actual work.
This makes services unit-testable without HTTP.

---

## What NOT to Do When Refactoring

- ❌ Refactor + add a feature in the same commit (review nightmare)
- ❌ Refactor + change behaviour (now you have two bugs to find)
- ❌ "Clean up" code right before a release
- ❌ Refactor a file you don't have a clear, near-term reason to modify
- ❌ Apply a design pattern because it's "cleaner" without measuring complexity (you
  often add abstraction overhead without reducing actual complexity)
- ❌ Refactor someone else's PR-in-flight without coordinating

---

## The "Boy Scout Rule" (with limits)

"Leave the code better than you found it" — but **only in the file you're already
touching for the feature/bug at hand.** If you start refactoring adjacent files, the
PR explodes, review takes a week, and the diff hides the actual change.

If you find a smell in an adjacent file: write a `// TODO(refactor):` note, file an
issue, and come back to it as a dedicated PR.

---

## Refactor PR Template

```
## What
Refactored `crates/backend/src/handlers/consent.rs` — extracted three helper
functions, replaced nested if-let chain with early returns.

## Why
Adding the new "scope upgrade" feature was awkward in the existing nesting.
This refactor makes that change a small diff in the next PR.

## Behaviour
**No behaviour changes.** All existing tests pass without modification.

## How to verify
- `cargo nextest run -p medichain-backend` — green
- `git diff main -- src/handlers/consent.rs` — pure structural changes
```

A good refactor PR is *boring*. Reviewers should be able to verify "behaviour
unchanged" quickly because the diff is mechanical.
