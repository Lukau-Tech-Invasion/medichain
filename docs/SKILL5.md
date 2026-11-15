
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

Otherwise the next dev refactors away the cache, performance regresses silently,
and the bug shows up six months later when usage hits a threshold.

---

## Tools Cheat Sheet

| Layer           | Profiler                                |
|-----------------|-----------------------------------------|
| Rust backend    | `cargo flamegraph`, `tokio-console`     |
| Frontend        | Chrome DevTools Performance, Lighthouse |
| Network         | Chrome DevTools Network, `mitmproxy`    |
| Database        | `EXPLAIN ANALYZE`, slow query log       |
| End-to-end      | Web Vitals (CLS, LCP, FID), real users  |
