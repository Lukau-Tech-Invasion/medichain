
# Debugging for MediChain

A bug is information, not a personal failure. The fastest way to fix it is the slowest
way to start: **reproduce it, narrow it, confirm a hypothesis, fix it.**

---

## The Universal Workflow

1. **Reproduce.** Get the bug to happen on demand. If you can't reproduce it, you can't
   verify your fix.
2. **Narrow.** Bisect. Comment out half. Disable feature flags. Find the smallest
   surface that still triggers it.
3. **Hypothesise.** Form a specific claim: "I think X happens because Y."
4. **Test the hypothesis.** Add a log, run a debugger, write a unit test. **Confirm
   with evidence**, don't trust your gut.
5. **Fix.** Once you understand, the fix is usually small.
6. **Add a regression test.** So this exact bug never returns.

If you skip step 1, you're guessing. If you skip step 4, you're cargo-culting.

---

## Rust — Backtraces

```bash
RUST_BACKTRACE=1 cargo run        # short backtrace
RUST_BACKTRACE=full cargo run     # full backtrace with std internals
```

A panic message tells you what. A backtrace tells you where. Read top to bottom — your
code is in the middle, not the top (the top is `core::panicking::panic`).

```
thread 'main' panicked at 'index out of bounds: the len is 0 but the index is 0',
crates/backend/src/handlers/consent.rs:42:18

stack backtrace:
   0: rust_begin_unwind
   1: core::panicking::panic_fmt
   2: core::panicking::panic_bounds_check
   3: medichain_backend::handlers::consent::list_consents     ← YOU
   4: <axum routing internals>
```

`crates/backend/src/handlers/consent.rs:42:18` — go there. The bug is on line 42.

---

## Rust — `dbg!`, `tracing`, and tests

For ad-hoc inspection:
```rust
let result = dbg!(compute_consent_pda(&owner, &doctor));   // prints to stderr + returns the value
```

For production-grade observability:
```rust
use tracing::{debug, info, warn, error, instrument};

#[instrument(skip(state), fields(patient_id = %req.patient_id))]
async fn grant_consent(state: AppState, req: GrantRequest) -> Result<Response> {
    debug!("validating request");
    // ...
    info!(consent_id = %consent.id, "consent granted");
    Ok(response)
}
```

`#[instrument]` auto-creates a span — every log inside is attributed to this call,
with the patient_id field. Massive quality-of-life win when chasing a bug across many
async tasks.

---

## Frontend — Failed Transactions

When `program.methods.x().rpc()` throws, the error usually contains:
```
SendTransactionError: Transaction simulation failed: Error processing Instruction 0:
custom program error: 0x1772
Logs: [
  "Program Med1Cha... invoke [1]",
  "Program log: Instruction: GrantConsent",
  "Program log: AnchorError caused by account: doctor_account...",
  ...
]
```

Catch it and inspect:

The logs array is gold. If you don't see logs, the transaction never reached the
program — it failed at validation (account ownership, signer missing, insufficient
fee). If you see logs, the program ran and the issue is inside.

---

## React — Common Bugs and Their Tells

**"Maximum update depth exceeded"** → infinite loop. Usually a `useEffect` with a
dependency that the effect itself updates, or a state setter called unconditionally
in render.

**"Can't perform a React state update on an unmounted component"** → an async
operation completed after the component unmounted. Cancel with `AbortController` or
use a flag in `useEffect` cleanup.

**"Hydration failed"** → SSR HTML didn't match client render. Often timestamps,
random values, or `window`/`document` accessed outside `useEffect`.

**Component "doesn't re-render"** → either state actually didn't change (object
mutated in place — React uses `Object.is`), or you're storing derived state instead
of computing it.

---

## Network Layer

```bash
# Watch the actual HTTP traffic between frontend and backend
mitmproxy -p 8888                       # then point browser/app at proxy
```

```bash
# What's actually being sent on the wire?
curl -v https://api.medichain.app/v1/patients/me \
  -H "Authorization: Bearer $JWT"
```

---

## NFC Layer

The hardware lies sometimes. Test in this order:
1. Does the tag read with a stock NFC scanner app? (NXP TagInfo, NFC Tools)
2. Does the URL it emits match what your writer claims it wrote?
3. Does the URL load the right page when manually pasted in a browser?
4. Does the page fetch the right data when given the URL?

Each "no" narrows the bug to a specific layer.

---

## The "Heisenbug" — Logs Make It Disappear

If adding a log makes the bug stop happening, you have a race condition or a
timing-dependent bug. Don't celebrate — the bug is still there, it's just hiding.

Look for:
- Shared mutable state without synchronisation
- `await` boundaries where you assumed a value was still valid
- Callbacks captured in closures with stale state
- Tests that pass alone but fail in a suite (test pollution)

---

## When Nothing Works

1. **Sleep on it.** Genuinely. Most of my hardest bugs were solved in the shower.
2. **Explain it to a person (rubber duck).** Articulating the problem often reveals it.
3. **`git bisect`** — when did it last work? Find the commit, read the diff.
4. **Revert to last known good, reapply changes one at a time.**
5. **Check the boring stuff** — env vars, dependency versions, cache, did you save
   the file, is the right service running, are you looking at the right env.

---

## What never to do

- ❌ Add `try { ... } catch {}` to "fix" an error you don't understand
- ❌ Sprinkle `setTimeout` to "fix" a race condition
- ❌ Comment out the failing test instead of investigating
- ❌ Tell the user "should be fixed now" without confirming
- ❌ Push a fix to prod without reproducing the bug locally first
