# Shared (client/shared)

Purpose: Shared code and utilities used by both frontends, including the typed `ApiClient` and endpoint definitions.

Key files:
- `src/api/endpoints.ts` — canonical endpoint definitions
- `src/api/client.ts` — HTTP wrapper, handles `X-User-Id` injection and base URL

Recommendation: Migrate remaining ad-hoc `fetch` callsites to use these wrappers to centralize headers and error handling.
