## PR Summary — docs: sync API docs and mapping

Branch: `cleanup/docs-sync-20260128`

This branch updates documentation to match the current implementation and adds mapping artifacts to help future refactors.

Files added/updated:
- `docs/frontend-backend-mapping.csv` — frontend wrapper endpoints and callsites (generated from repo scan)
- `docs/server-endpoints.csv` — Actix route list extracted from `api/src`
- `docs/frontend-backend-crossref.csv` — cross-reference marking endpoints used by frontend
- `docs/DEV_AUTH.md` — developer auth & demo seed guidance
- `docs/api.md` — top-level API notes (appended)
- `scripts/crossref_endpoints.py` — helper script used to generate `frontend-backend-crossref.csv`
- `client/*/README.md`, `api/README.md`, `pallets/README.md`, `client/shared/README.md` — per-module README stubs

What I checked:
- Extracted Actix route annotations and matched them to frontend callsites found under `client/`.
- Marked endpoints as `used` or `no` in `frontend-backend-crossref.csv` when no frontend callsite was found.

Suggested next steps (not applied in this PR):
- Replace remaining ad-hoc `fetch` calls with `client/shared` API wrappers.
- Gate demo endpoints behind an env flag (`ENABLE_DEMO_ENDPOINTS`) and document seed process.
- Run `cargo clippy -- -D warnings` and `npm run typecheck` to surface issues before merging.
