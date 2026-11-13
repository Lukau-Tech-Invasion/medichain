# Shared (client/shared)

Purpose: Shared code and utilities used by both frontends, including the typed `ApiClient` and endpoint definitions.

Key files:
- `src/api/endpoints/` — canonical endpoint definitions, one module per domain
- `src/api/client.ts` — HTTP wrapper: base URL, bearer-token session, refresh, retry

Recommendation: Migrate remaining ad-hoc `fetch` callsites to use these wrappers to centralize headers and error handling.
