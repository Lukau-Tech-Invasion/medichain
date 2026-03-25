---
name: performance-optimization
description: >
  Performance work for MediChain — compute-unit budgets on Solana, Rust backend latency,
  React/PWA load time on budget Android, NFC tap-to-display under 3 seconds. Covers the
  "measure first" rule, profiling tools per layer, common bottlenecks, and when not to
  optimise. Activate when the user says "it's slow", "lagging", "high CPU", "long
  transaction", "compute units exceeded", "p99 latency", "bundle size too big", "lighthouse
  score", "the tap takes too long", or any complaint about speed. NEVER activate to
  optimise something the user hasn't measured.
---

# Performance Optimisation for MediChain

The performance promise: **3 seconds from NFC tap to blood-type-on-screen, even on a
2019 Samsung A20 in a low-coverage township.** Everything else flows from there.

But: **measure first.** Premature optimisation is the largest source of complexity in
software. The rule is Knuth's: only optimise what profiling proves is slow.

---

## The Workflow

1. **Define the budget.** "NFC tap to display: 3000ms total." Without a number you
   can't tell if you're done.
2. **Measure.** Real device, real network, real data. Not your dev MacBook on fibre.
3. **Find the bottleneck.** Profiling shows where time actually goes — usually
   surprises you.
4. **Optimise the bottleneck.** Not your favourite slow thing. The actual one.
5. **Re-measure.** Confirm improvement. Sometimes "optimisations" make things worse.

---

## Solana Compute Units (CU)

Each instruction has a CU limit. Default 200k, max 1.4M per transaction. CU costs:

| Operation                          | Approx CU                  |
|------------------------------------|----------------------------|
| Account read                       | ~1k                        |
| Account write                      | ~1k                        |
| `Clock::get()`                     | ~100                       |
| `msg!()` simple string             | ~100                       |
| `msg!()` formatted                 | ~1k+ (be careful)          |
| `sha256` of 32 bytes               | ~100                       |
| `keccak256` of 32 bytes            | ~250                       |
| `ed25519_verify`                   | ~3000 (use the precompile) |
| Borsh serialise small struct       | ~500                       |
| `find_program_address`             | ~1500 to ~10000 (varies)   |
| Vec push (heap alloc)              | ~1000+                     |

**Rules:**
- **Store bumps.** Re-deriving a PDA in a hot path costs thousands of CU.
- **Avoid loops over user-controlled length.** Cap them or split the work.
- **`msg!` only what you'd actually want to see.** It's not free.
- **Pre-compute off-chain when possible** and pass the result as instruction data.

If hitting the limit:
```rust
// Request more CU at the start of the transaction (TS side)
import { ComputeBudgetProgram } from "@solana/web3.js";
const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
tx.add(ix);
```

But this isn't free — bigger CU = higher fees + bigger blocks = worse for everyone.
Optimise the program first.

---

## Rust Backend — Profiling

```bash
# Sampling profiler
cargo install flamegraph
cargo flamegraph --bin medichain-backend

# Async-aware profiler
cargo install tokio-console
# Add `console-subscriber` to your tracing setup
RUSTFLAGS="--cfg tokio_unstable" cargo run
tokio-console
```

Flame graph: wide bar = lots of time. Look for surprises (e.g. JSON parsing taking
40% — switch to `simd-json`).

`tokio-console` shows live tasks, their state, and where they're blocked. Catches
things like a synchronous file read inside an async handler.

---

## Common Backend Bottlenecks (and fixes)

| Symptom                              | Likely cause / fix                            |
|--------------------------------------|-----------------------------------------------|
| All endpoints slow under load        | DB connection pool too small                  |
| One endpoint 100x slower than others | N+1 query — fetch in batch                    |
| RPC calls blocking handler           | Use connection pool, set timeout, parallelise |
| High CPU but low throughput          | Synchronous CPU work in async task — `spawn_blocking` |
| Memory growing forever               | Unbounded channel / Vec — bound + backpressure|
| TLS handshake dominates request time | Keep-alive misconfigured                      |

---

## Frontend — Lighthouse + Real Device

```bash
# CI: Lighthouse on every PR
npm install -g @lhci/cli
lhci autorun --config=lighthouserc.json
```

Targets:
- LCP (Largest Contentful Paint): < 2.5s on slow 4G
- FID (First Input Delay): < 100ms
- CLS (Cumulative Layout Shift): < 0.1
- TTI (Time to Interactive): < 3.5s
- Bundle: < 200KB initial JS gzipped

Real device testing (don't skip):
- Chrome DevTools → Performance → CPU 4x slowdown + Slow 3G throttle
- Better: borrow a budget Android, test on actual cellular

---

## Frontend Common Wins

- **Code-split** by route. The patient app shouldn't ship the doctor portal bundle.
- **Avoid moment.js / lodash.** Use native Date (or `date-fns/esm`) and individual
  lodash imports.
- **Image discipline.** WebP/AVIF, responsive `srcset`, lazy-load below the fold.
- **Don't ship icon fonts.** Inline SVGs of just the icons you use.
- **`React.memo` heavy components** — but only after profiling shows they re-render
  unnecessarily.
- **Virtualise long lists** (`react-virtuoso`, `tanstack/virtual`).
- **Defer non-critical scripts** (analytics, etc.) past first interaction.

---

## The 3-Second Paramedic Path — Detailed Budget

```
NFC tap → URL emitted by phone OS                  ~200ms (varies by device)
URL opens in browser/PWA                           ~300ms (cold start; ~50ms warm)
Service worker serves shell                        ~100ms
JS parse + execute                                 ~400ms (must be <200KB gz)
Capability token verified locally (Ed25519)        ~50ms
API request to /emergency/fetch                    ~600ms (network + backend)
Response decrypt + render                          ~150ms
Total                                              ~1800ms ✅
```

Worst-case on slow 3G + cold cache:
```
NFC tap                                            ~200ms
URL → browser                                      ~500ms
Network roundtrip for shell (cached SW: 0)         0ms (must be cached)
JS parse                                           ~800ms (slow CPU)
Token verify                                       ~100ms
API call (slow 3G, ~600ms RTT, 1KB response)       ~1500ms
Render                                             ~300ms
Total                                              ~3400ms ⚠️
```

We're already cutting it close. Mitigations:
- Pre-warm the PWA via patient app (when patient gets their card, the app briefly
  visits the reader to warm the SW + cache)
- Inline the critical CSS + JS for the reader shell (single HTML file, no extra round trip)
- Backend response uses `Cache-Control: no-store` but `keep-alive` reuses connection

---

## When NOT to Optimise

- ❌ A function called once per app start, taking 50ms
- ❌ A component that re-renders 5 times per minute, each render costs 0.5ms
- ❌ A query that runs in the background, doesn't block UI, takes 200ms
- ❌ Your favourite thing that "feels slow" but you haven't measured
- ❌ Code you haven't shipped yet (will it even survive code review?)

The cost of optimisation: complexity, harder debugging, more tests, more reviewer
attention. Pay it only when the win justifies it.

---

## When YES, Optimise

- ✅ NFC tap-to-display path (it's the product pitch)
- ✅ Patient app first-load (90% of users will judge in 5s)
- ✅ Doctor portal record search (used 100s of times per shift)
- ✅ Anything blocking emergency or safety workflows

---

## Documenting Performance Decisions

Once you optimise, write down WHY:

```rust
// PERF: We cache patient PDA in memory because re-deriving is ~10k CU on-chain
// and we read it on every consent check. Cache is keyed by (patient_pubkey,
// program_id) and invalidated on patient account close.
```

Otherwise the next dev refactors away the cache, performance regresses silently,
and the bug shows up six months later when usage hits a threshold.

---

## Tools Cheat Sheet

| Layer           | Profiler                                |
|-----------------|-----------------------------------------|
| Solana program  | `solana program logs`, anchor BPF debugger |
| Rust backend    | `cargo flamegraph`, `tokio-console`     |
| Frontend        | Chrome DevTools Performance, Lighthouse |
| Network         | Chrome DevTools Network, `mitmproxy`    |
| Database        | `EXPLAIN ANALYZE`, slow query log       |
| End-to-end      | Web Vitals (CLS, LCP, FID), real users  |
