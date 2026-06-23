# MediChain Performance Budgets

> **Phase 12.1.** Defines the latency/size budgets the product must hold, how
> they are measured, and where they are enforced.

MediChain's headline promise — *"a paramedic taps an NFC card and within 3
seconds sees blood type, allergies, and emergency contacts"* — is a hard
performance requirement, not a nice-to-have. These budgets make it measurable.

## 1. The 3-second NFC budget (critical path)

End-to-end target: **tap → emergency info on screen ≤ 3000 ms** (p95), on a
mid-range Android device over a 3G-equivalent connection.

| Segment | Budget (p95) | Where measured |
|---------|-------------|----------------|
| NFC read + hash lookup (client) | ≤ 300 ms | client instrumentation |
| `POST /api/emergency-access` (server, warm) | ≤ 400 ms | `X-Response-Time` / `/api/metrics` histogram |
| Network round-trip (3G) | ≤ 1500 ms | field/RUM |
| Render emergency card | ≤ 500 ms | Lighthouse / RUM |
| **Total** | **≤ 3000 ms** | end-to-end trace |

**Server-side measurement:** the metrics middleware (Phase 8.2) records a
per-route latency histogram exposed at `GET /api/metrics` (Prometheus format),
including `http_request_duration_seconds`. Alert if the emergency-access route
p95 exceeds 0.4 s.

## 2. Frontend budgets (Lighthouse)

Enforced by Lighthouse CI (`client/.lighthouserc.json`) in the `lighthouse` CI
job against a production build of each app:

| Metric | Budget |
|--------|--------|
| Largest Contentful Paint (LCP) | < 2.5 s |
| Time To Interactive (TTI) | < 3.5 s |
| Total Blocking Time (TBT) | < 300 ms |
| Cumulative Layout Shift (CLS) | < 0.1 |
| Performance score | ≥ 0.85 |

## 3. Bundle-size budgets

| Bundle | Budget (gzipped initial JS) | Measured (Phase 12.1) |
|--------|------------------------------|------------------------|
| doctor-portal | < 250 KB | **~104 KB** (entry + index + vendor + router + icons) |
| patient-app | < 200 KB | **~89 KB** (index + vendor + router + icons) |

How the budget is held:

- **Route-level code splitting.** Both apps `React.lazy` every non-critical page
  (only Login + Dashboard are eager), so each page ships as its own chunk loaded
  on navigation. The two apps build separately and do **not** ship each other's code.
- **Vendor splitting.** `vite.config.ts` `manualChunks` separates long-lived libs
  (`react`/`react-dom` → `vendor`, `react-router-dom` → `router`, `zustand` → `state`,
  `lucide-react` → `icons`, plus `date-fns`/`qrcode`) so they cache across deploys.
- **Heavy wallet libs are lazy.** `@polkadot/extension-dapp` + `@polkadot/util`
  (~188 KB gzip) are dynamically imported inside `connectRealWallet`/`signMessage`
  (`client/shared/src/wallet/service.ts`) — they load only on a real (non-demo)
  wallet sign, never on first paint. `qrcode` (~9.5 KB gzip) is likewise its own
  chunk, loaded only by QR pages.

**Inspecting composition:** `ANALYZE=1 npm run build --workspace=<app>` emits a
gzip/brotli treemap to `dist/stats.html` (via `rollup-plugin-visualizer`). A plain
`npm run build` prints per-chunk gzip sizes and never depends on the analyzer.

## 4. Backend profiling

- `cargo flamegraph --bin medichain-api` to find hot paths under load.
- Optional `tokio-console` for async task stalls (gate behind a `tokio_unstable` build).
- Load test the emergency path: `k6`/`oha` against `/api/emergency-access` and watch the `/api/metrics` histogram.

## 5. Status

- [x] Budgets defined (this document).
- [x] Server latency histogram via `/api/metrics` (Phase 8.2).
- [x] Lighthouse CI config + job (`client/.lighthouserc.json`).
- [x] Code-split both apps (route-level lazy + `manualChunks` + lazy wallet libs) and
      bundle analysis (`ANALYZE=1` → `rollup-plugin-visualizer`); both apps measured
      under budget (doctor ~104 KB, patient ~89 KB gzip initial JS).
- [ ] Wire client-side NFC-segment instrumentation + RUM reporting.
- [ ] Add `cargo flamegraph` / load-test step to CI (manual for now).
